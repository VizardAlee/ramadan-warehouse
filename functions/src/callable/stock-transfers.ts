import { createHash, randomUUID } from "node:crypto";
import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { enforceAppCheck } from "../config.js";
import {
  hasRole,
  requireAccess,
  type AccessProfile,
} from "../auth/authorize.js";
import { parseInput } from "../utils/callable.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { balanceDocumentId } from "../inventory/calculations.js";
import {
  pendingStock,
  type StockTransfer,
  type StockTransferLine,
} from "../transfers/simple-model.js";

const id = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine((value) => !value.includes("/") && value !== "." && value !== "..");
const quantity = z.number().int().min(0).max(1_000_000);
const item = z.object({
  productId: id,
  quantity: quantity.min(1),
  lotId: id.optional(),
  sourceRequestItemId: id.optional(),
});
const actionBase = {
  transferId: id,
  version: z.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(),
};
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("options") }),
  z.object({ action: z.literal("stock"), locationId: id }),
  z.object({ action: z.literal("list"), cursor: id.optional() }),
  z.object({ action: z.literal("get"), transferId: id }),
  z.object({
    action: z.literal("create"),
    sourceLocationId: id,
    destinationLocationId: id,
    sourceRequestId: id.optional(),
    note: z.string().trim().max(500).default(""),
    items: z.array(item).min(1).max(20),
    idempotencyKey: z.string().uuid(),
  }),
  z.object({
    action: z.literal("approve"),
    ...actionBase,
    lines: z
      .array(
        z.object({
          id,
          quantity,
          serialItemIds: z.array(id).max(100).default([]),
        }),
      )
      .min(1)
      .max(20),
  }),
  z.object({
    action: z.literal("receive"),
    ...actionBase,
    lines: z
      .array(
        z.object({
          id,
          received: quantity,
          damaged: quantity,
          serialItemIds: z.array(id).max(100).default([]),
          damagedSerialItemIds: z.array(id).max(100).default([]),
        }),
      )
      .min(1)
      .max(20),
    note: z.string().trim().max(1000).default(""),
  }),
  z.object({
    action: z.literal("report_problem"),
    ...actionBase,
    note: z.string().trim().min(3).max(1000),
  }),
  z.object({
    action: z.literal("resolve"),
    ...actionBase,
    disposition: z.enum(["still_expected", "never_left", "lost"]),
    note: z.string().trim().min(3).max(1000),
  }),
]);
const clean = (data: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
const num = (doc: DocumentSnapshot, field: string) =>
  Number(doc.get(field) ?? 0);
const admin = (actor: AccessProfile) =>
  hasRole(actor, "system_administrator") ||
  hasRole(actor, "operations_administrator");
const manager = (actor: AccessProfile) =>
  admin(actor) ||
  hasRole(actor, "warehouse_manager") ||
  hasRole(actor, "branch_manager");
const fail = (
  message: string,
  code = "STOCK_TRANSFER_ACTION_REQUIRED",
): never => {
  throw new HttpsError("failed-precondition", message, {
    code,
    userMessage: message,
  });
};
function owns(
  actor: AccessProfile,
  location: { branchId?: string; warehouseId?: string },
) {
  return (
    admin(actor) ||
    Boolean(
      location.branchId &&
        hasRole(actor, "branch_manager") &&
        actor.branchIds.includes(location.branchId),
    ) ||
    Boolean(
      location.warehouseId &&
        hasRole(actor, "warehouse_manager") &&
        actor.warehouseIds.includes(location.warehouseId),
    )
  );
}
function canRead(actor: AccessProfile, transfer: StockTransfer) {
  return (
    admin(actor) ||
    hasRole(actor, "auditor") ||
    hasRole(actor, "finance_officer") ||
    owns(actor, {
      branchId: transfer.sourceBranchId,
      warehouseId: transfer.sourceWarehouseId,
    }) ||
    owns(actor, { branchId: transfer.destinationBranchId })
  );
}
function data(snapshot: DocumentSnapshot): StockTransfer {
  return { ...snapshot.data(), id: snapshot.id } as StockTransfer;
}
function validateLocation(
  doc: DocumentSnapshot,
  org: string,
  destination = false,
) {
  if (
    !doc.exists ||
    doc.get("organizationId") !== org ||
    doc.get("status") !== "active" ||
    !(destination ? ["branch"] : ["warehouse", "branch"]).includes(
      doc.get("type"),
    )
  )
    fail("Choose an active stock location.");
}
function event(
  tx: Transaction,
  actor: AccessProfile,
  transfer: StockTransfer,
  action: string,
  key: string,
  details: Record<string, unknown> = {},
) {
  const now = FieldValue.serverTimestamp();
  tx.create(db.collection("stockTransferEvents").doc(), {
    organizationId: actor.organizationId,
    transferId: transfer.id,
    action,
    actorUserId: actor.userId,
    createdAt: now,
    ...details,
  });
  writeAuditLog(tx, actor, {
    action: `stock_transfer.${action}`,
    entityType: "stockTransfer",
    entityId: transfer.id,
    correlationId: key,
    sourceFunction: "stockTransfers",
    after: details,
  });
  tx.create(
    db.collection("notificationEvents").doc(),
    clean({
      organizationId: actor.organizationId,
      entityId: transfer.id,
      entityType: "stockTransfer",
      eventType: `stock_transfer.${action}`,
      templateKey: "stock_transfer_v1",
      branchId: transfer.destinationBranchId,
      warehouseId: transfer.sourceWarehouseId,
      recipientRoles:
        action === "created" || action === "report_problem"
          ? ["system_administrator", "operations_administrator"]
          : ["branch_manager"],
      recipientIds: [],
      channelPreferences: {},
      status: "pending",
      attemptCount: 0,
      idempotencyKey: key,
      createdAt: now,
    }),
  );
}

export const stockTransfers = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  if (
    !manager(actor) &&
    !hasRole(actor, "auditor") &&
    !hasRole(actor, "finance_officer")
  )
    throw new HttpsError(
      "permission-denied",
      "A location manager or administrator must handle stock transfers.",
    );
  const input = parseInput(inputSchema, request.data);
  if (
    input.action === "approve" &&
    input.lines.reduce((sum, line) => sum + line.serialItemIds.length, 0) > 100
  )
    fail(
      "Transfer up to 100 serialized units at a time. Split larger requests into separate transfers.",
    );
  if (input.action === "options") {
    // Only names/identities needed to request stock are discoverable across branches.
    const [locations, branches, warehouses] = await Promise.all(
      ["inventoryLocations", "branches", "warehouses"].map((collection) =>
        db
          .collection(collection)
          .where("organizationId", "==", actor.organizationId)
          .get(),
      ),
    );
    const units = new Map(
      [...branches!.docs, ...warehouses!.docs]
        .filter((d) => d.get("status") === "active")
        .map((d) => [d.id, d.get("name")]),
    );
    return {
      locations: locations!.docs
        .filter(
          (d) =>
            ["branch", "warehouse"].includes(d.get("type")) &&
            d.get("status") === "active" &&
            units.has(d.get("branchId") ?? d.get("warehouseId")),
        )
        .map((d) => ({
          id: d.id,
          name: units.get(d.get("branchId") ?? d.get("warehouseId")),
          stockArea: d.get("name"),
          type: d.get("type"),
          branchId: d.get("branchId") ?? null,
          warehouseId: d.get("warehouseId") ?? null,
          assigned: owns(actor, d.data()),
        })),
      canApprove: admin(actor),
    };
  }
  if (input.action === "stock") {
    const location = await db
      .doc(`inventoryLocations/${input.locationId}`)
      .get();
    validateLocation(location, actor.organizationId);
    const [balances, products] = await Promise.all([
      db
        .collection("inventoryBalances")
        .where("organizationId", "==", actor.organizationId)
        .where("locationId", "==", input.locationId)
        .get(),
      db
        .collection("products")
        .where("organizationId", "==", actor.organizationId)
        .where("active", "==", true)
        .get(),
    ]);
    const productMap = new Map(products.docs.map((d) => [d.id, d]));
    const lotIds = [
      ...new Set(
        balances.docs
          .map((d) => d.get("lotId"))
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    ];
    const lots = lotIds.length
      ? await db.getAll(...lotIds.map((id) => db.doc(`inventoryLots/${id}`)))
      : [];
    const lotNames = new Map(
      lots
        .filter(
          (d) => d.exists && d.get("organizationId") === actor.organizationId,
        )
        .map((d) => [d.id, d.get("lotNumber")]),
    );
    const serials =
      admin(actor) || owns(actor, location.data()!)
        ? await db
            .collection("serializedItems")
            .where("organizationId", "==", actor.organizationId)
            .where("currentLocationId", "==", input.locationId)
            .get()
        : null;
    return {
      stock: balances.docs
        .filter(
          (d) =>
            num(d, "availableQuantity") > 0 &&
            productMap.has(d.get("productId")),
        )
        .map((d) => ({
          id: d.id,
          productId: d.get("productId"),
          name: productMap.get(d.get("productId"))!.get("name"),
          sku: productMap.get(d.get("productId"))!.get("sku"),
          trackingType: productMap.get(d.get("productId"))!.get("trackingType"),
          lotId: d.get("lotId") ?? null,
          lotNumber: lotNames.get(d.get("lotId")) ?? null,
          available: d.get("availableQuantity"),
          serials:
            serials?.docs
              .filter(
                (s) =>
                  s.get("productId") === d.get("productId") &&
                  !s.get("reservedTransferId") &&
                  ["available", "at_branch"].includes(s.get("status")),
              )
              .map((s) => ({ id: s.id, name: s.get("serialNumber") })) ?? [],
        })),
    };
  }
  if (input.action === "list") {
    // Scan bounded pages; only authorized rows leave the server, even on an empty page.
    let query = db
      .collection("stockTransfers")
      .where("organizationId", "==", actor.organizationId)
      .orderBy(FieldPath.documentId())
      .limit(100);
    if (input.cursor) query = query.startAfter(input.cursor);
    const snapshots = await query.get();
    return {
      rows: snapshots.docs.map(data).filter((t) => canRead(actor, t)),
      nextCursor: snapshots.size === 100 ? snapshots.docs.at(-1)!.id : null,
    };
  }
  if (input.action === "get") {
    const snapshot = await db.doc(`stockTransfers/${input.transferId}`).get();
    if (
      !snapshot.exists ||
      snapshot.get("organizationId") !== actor.organizationId ||
      !canRead(actor, data(snapshot))
    )
      throw new HttpsError("not-found", "Transfer not found.");
    const transfer = data(snapshot);
    const events = await db
      .collection("stockTransferEvents")
      .where("organizationId", "==", actor.organizationId)
      .where("transferId", "==", input.transferId)
      .get();
    return {
      transfer,
      events: events.docs
        .map((d) => ({
          ...d.data(),
          id: d.id,
          createdAt: d.get("createdAt")?.toDate?.().toISOString() ?? null,
        }))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
      canApprove:
        admin(actor) ||
        owns(actor, {
          branchId: transfer.sourceBranchId,
          warehouseId: transfer.sourceWarehouseId,
        }),
      canReceive:
        owns(actor, { branchId: transfer.destinationBranchId }) &&
        manager(actor),
    };
  }
  if (!manager(actor))
    throw new HttpsError(
      "permission-denied",
      "Only a manager can change a transfer.",
    );
  const operation = db.doc(
    `idempotencyKeys/${actor.organizationId}_stockTransfer_${input.idempotencyKey}`,
  );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const ref =
    input.action === "create"
      ? db.collection("stockTransfers").doc()
      : db.doc(`stockTransfers/${input.transferId}`);
  return db.runTransaction(async (tx) => {
    const previous = await tx.get(operation);
    if (previous.exists) {
      if (
        previous.get("actorId") !== actor.userId ||
        previous.get("action") !== input.action
      )
        throw new HttpsError(
          "permission-denied",
          "This operation belongs to another request.",
        );
      if (previous.get("fingerprint") !== fingerprint)
        fail(
          "This retry has different details. Refresh the transfer before submitting a new action.",
        );
      return { transferId: previous.get("transferId"), repeated: true };
    }
    const now = new Date().toISOString();
    if (input.action === "create") {
      const [source, destination, ...products] = await tx.getAll(
        db.doc(`inventoryLocations/${input.sourceLocationId}`),
        db.doc(`inventoryLocations/${input.destinationLocationId}`),
        ...input.items.map((line) => db.doc(`products/${line.productId}`)),
      );
      validateLocation(source!, actor.organizationId);
      validateLocation(destination!, actor.organizationId, true);
      if (
        source!.id === destination!.id ||
        (source!.get("branchId") &&
          source!.get("branchId") === destination!.get("branchId"))
      )
        fail(
          "Choose two different locations. Use Internal movement for areas in the same branch.",
        );
      if (!owns(actor, source!.data()!) && !owns(actor, destination!.data()!))
        throw new HttpsError(
          "permission-denied",
          "Choose your own location as the source or destination.",
        );
      const units = await tx.getAll(
        db.doc(
          `${source!.get("branchId") ? "branches" : "warehouses"}/${source!.get("branchId") ?? source!.get("warehouseId")}`,
        ),
        db.doc(`branches/${destination!.get("branchId")}`),
      );
      if (
        units.some(
          (u) =>
            !u.exists ||
            u.get("organizationId") !== actor.organizationId ||
            u.get("status") !== "active",
        )
      )
        fail("The branch or warehouse is no longer active.");
      if (
        new Set(input.items.map((l) => `${l.productId}:${l.lotId ?? ""}`))
          .size !== input.items.length
      )
        fail("Combine duplicate product rows before submitting.");
      const items: StockTransferLine[] = input.items.map((line, index) => {
        const product = products[index]!;
        if (
          !product.exists ||
          product.get("organizationId") !== actor.organizationId ||
          product.get("active") !== true
        )
          fail("A selected product is no longer available.");
        if ((product.get("trackingType") === "batch") !== Boolean(line.lotId))
          fail("Choose the correct stock lot for this product.");
        return clean({
          id: randomUUID(),
          productId: line.productId,
          productName: product.get("name"),
          sku: product.get("sku"),
          trackingType: product.get("trackingType"),
          lotId: line.lotId,
          sourceRequestItemId: line.sourceRequestItemId,
          serialItemIds: [],
          requested: line.quantity,
          approved: 0,
          received: 0,
          damaged: 0,
          cancelled: 0,
          writtenOff: 0,
        }) as unknown as StockTransferLine;
      });
      const requestWrite = input.sourceRequestId
        ? await linkRequest(
            tx,
            actor,
            input.sourceRequestId,
            destination!.get("branchId"),
            items,
            "allocate",
          )
        : null;
      const transfer = clean({
        id: ref.id,
        organizationId: actor.organizationId,
        number: `ST-${now.slice(0, 4)}-${ref.id.slice(0, 8).toUpperCase()}`,
        status: "requested",
        version: 0,
        sourceLocationId: source!.id,
        destinationLocationId: destination!.id,
        sourceName: units[0]!.get("name"),
        destinationName: units[1]!.get("name"),
        sourceBranchId: source!.get("branchId"),
        sourceWarehouseId: source!.get("warehouseId"),
        destinationBranchId: destination!.get("branchId"),
        sourceRequestId: input.sourceRequestId,
        note: input.note,
        problemNote: "",
        createdBy: actor.userId,
        items,
        createdAt: now,
        updatedAt: now,
      }) as unknown as StockTransfer;
      tx.create(ref, transfer as unknown as Record<string, unknown>);
      requestWrite?.();
      event(tx, actor, transfer, "created", input.idempotencyKey);
    } else {
      const snapshot = await tx.get(ref);
      if (
        !snapshot.exists ||
        snapshot.get("organizationId") !== actor.organizationId ||
        !canRead(actor, data(snapshot))
      )
        throw new HttpsError("not-found", "Transfer not found.");
      const transfer = data(snapshot);
      if (transfer.version !== input.version)
        fail("This transfer changed. Refresh it before continuing.");
      if (["completed", "cancelled"].includes(transfer.status))
        fail("This transfer is already finished.");
      if (
        ["approve", "resolve"].includes(input.action) &&
        !admin(actor) &&
        !owns(actor, {
          branchId: transfer.sourceBranchId,
          warehouseId: transfer.sourceWarehouseId,
        })
      )
        throw new HttpsError(
          "permission-denied",
          "A manager responsible for the source location must approve or resolve this transfer.",
        );
      if (input.action === "report_problem") {
        if (transfer.status === "requested")
          fail("This transfer has not been approved yet.");
        tx.update(ref, {
          status: "problem",
          problemNote: input.note,
          version: transfer.version + 1,
          updatedAt: now,
        });
      } else {
        await changeStock(tx, actor, transfer, input, now);
      }
      event(tx, actor, transfer, input.action, input.idempotencyKey, {
        note: "note" in input ? input.note : "",
        ...(input.action === "approve" || input.action === "receive"
          ? { lines: input.lines }
          : {}),
        ...(input.action === "resolve"
          ? { disposition: input.disposition }
          : {}),
      });
    }
    tx.create(operation, {
      organizationId: actor.organizationId,
      transferId: ref.id,
      actorId: actor.userId,
      action: input.action,
      fingerprint,
      createdAt: now,
    });
    return { transferId: ref.id, repeated: false };
  });
});

// Request demand is independent of a transfer's held quantity. Only good receipts fulfil demand.
async function linkRequest(
  tx: Transaction,
  actor: AccessProfile,
  requestId: string,
  branchId: string,
  lines: StockTransferLine[],
  action: "allocate" | "update",
  before: StockTransferLine[] = [],
  wasRequested = false,
) {
  const snapshots = await tx.getAll(
    db.doc(`branchRequests/${requestId}`),
    ...lines.map((l) =>
      db.doc(`branchRequestItems/${l.sourceRequestItemId ?? "invalid"}`),
    ),
  );
  const request = snapshots[0]!;
  if (
    !request.exists ||
    request.get("organizationId") !== actor.organizationId ||
    request.get("branchId") !== branchId ||
    !["approved", "partially_approved", "partially_fulfilled"].includes(
      request.get("status"),
    )
  )
    fail("Choose an approved request for the receiving branch.");
  if (new Set(lines.map((l) => l.sourceRequestItemId)).size !== lines.length)
    fail("Each request item may appear only once.");
  let received = 0;
  const changes = lines.map((line, index) => {
    const item = snapshots[index + 1]!;
    if (
      !item.exists ||
      item.get("organizationId") !== actor.organizationId ||
      item.get("requestId") !== requestId ||
      item.get("productId") !== line.productId
    )
      fail("The selected request items do not match this transfer.");
    const old = before[index];
    const fulfilledDelta = old ? line.received - old.received : 0;
    const held = (l: StockTransferLine) =>
      l.approved - l.received - l.cancelled - l.damaged - l.writtenOff;
    const allocationDelta =
      action === "allocate"
        ? line.requested
        : held(line) - (wasRequested ? old!.requested : held(old!));
    const allocated = num(item, "transferAllocatedQuantity") + allocationDelta;
    const fulfilled = num(item, "fulfilledQuantity") + fulfilledDelta;
    if (allocated < 0 || allocated + fulfilled > num(item, "approvedQuantity"))
      fail("This request quantity is already allocated to another transfer.");
    received += fulfilledDelta;
    return {
      ref: item.ref,
      values: {
        transferAllocatedQuantity: allocated,
        fulfilledQuantity: fulfilled,
        outstandingQuantity: num(item, "approvedQuantity") - fulfilled,
        updatedAt: FieldValue.serverTimestamp(),
      },
    };
  });
  return () => {
    changes.forEach((c) => tx.update(c.ref, c.values));
    if (received) {
      const total = num(request, "totalFulfilledQuantity") + received;
      tx.update(request.ref, {
        totalFulfilledQuantity: total,
        totalOutstandingQuantity: num(request, "totalApprovedQuantity") - total,
        status:
          total === num(request, "totalApprovedQuantity")
            ? "fulfilled"
            : "partially_fulfilled",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.userId,
      });
    }
  };
}

type StockAction = Extract<
  z.infer<typeof inputSchema>,
  { action: "approve" | "receive" | "resolve" }
>;
async function changeStock(
  tx: Transaction,
  actor: AccessProfile,
  transfer: StockTransfer,
  input: StockAction,
  now: string,
) {
  const approving = input.action === "approve";
  if (approving && transfer.status !== "requested")
    fail("This transfer has already been approved.");
  if (
    !approving &&
    transfer.status === "requested" &&
    !(input.action === "resolve" && input.disposition === "never_left")
  )
    fail("Approve this transfer before receiving it.");
  if (
    input.action === "receive" &&
    !owns(actor, { branchId: transfer.destinationBranchId })
  )
    throw new HttpsError(
      "permission-denied",
      "Only the receiving branch manager or an administrator can acknowledge arrival.",
    );
  if (
    "lines" in input &&
    (input.lines.length !== transfer.items.length ||
      new Set(input.lines.map((l) => l.id)).size !== input.lines.length ||
      input.lines.some((l) => !transfer.items.some((i) => i.id === l.id)))
  )
    fail("Review every product in this transfer.");
  if (input.action === "resolve" && input.disposition === "still_expected") {
    const completed = transfer.items.every((l) => pendingStock(l) === 0);
    tx.update(
      db.doc(`stockTransfers/${transfer.id}`),
      clean({
        status: completed
          ? "completed"
          : transfer.items.some((l) => l.received || l.damaged)
            ? "partially_received"
            : "awaiting_receipt",
        problemNote: "",
        version: transfer.version + 1,
        updatedAt: now,
        completedAt: completed ? now : undefined,
      }),
    );
    return;
  }
  const [source, destination, damaged] = await tx.getAll(
    db.doc(`inventoryLocations/${transfer.sourceLocationId}`),
    db.doc(`inventoryLocations/${transfer.destinationLocationId}`),
    db.doc(`inventoryLocations/simple_damaged_${transfer.destinationBranchId}`),
  );
  validateLocation(source!, actor.organizationId);
  validateLocation(destination!, actor.organizationId, true);
  if (
    damaged!.exists &&
    (damaged!.get("organizationId") !== actor.organizationId ||
      damaged!.get("branchId") !== transfer.destinationBranchId ||
      damaged!.get("type") !== "damaged")
  )
    fail("The damaged stock area requires administrator review.");
  const next = transfer.items.map((l) => ({
    ...l,
    serialItemIds: [...l.serialItemIds],
  }));
  // Read every balance and tracking record before the first write. Firestore retries the whole receipt on concurrent sales.
  const plans = [];
  for (const line of next) {
    const submitted =
      "lines" in input ? input.lines.find((l) => l.id === line.id)! : null;
    const approval = approving
      ? (submitted as Extract<
          StockAction,
          { action: "approve" }
        >["lines"][number])
      : null;
    const receipt =
      input.action === "receive"
        ? (submitted as Extract<
            StockAction,
            { action: "receive" }
          >["lines"][number])
        : null;
    const pending = pendingStock(line);
    const received = receipt?.received ?? 0,
      bad = receipt?.damaged ?? 0;
    const cancel =
      input.action === "resolve" && input.disposition === "never_left"
        ? pending
        : 0;
    const lost =
      input.action === "resolve" && input.disposition === "lost" ? pending : 0;
    if (approval && approval.quantity > line.requested)
      fail("Approval cannot exceed the requested quantity.");
    if (received + bad > pending || pending < 0)
      fail("The received quantity exceeds what is still expected.");
    const selected = approval?.serialItemIds ?? [
      ...(receipt?.serialItemIds ?? []),
      ...(receipt?.damagedSerialItemIds ?? []),
    ];
    const releasedIds =
      input.action === "resolve" ? line.serialItemIds : selected;
    const total = approval?.quantity ?? received + bad;
    if (
      line.trackingType === "serial" &&
      (selected.length !== total || new Set(selected).size !== selected.length)
    )
      fail("Choose one unique serial number for each unit.");
    if (
      receipt &&
      line.trackingType === "serial" &&
      (receipt.serialItemIds.length !== received ||
        receipt.damagedSerialItemIds.length !== bad ||
        selected.some((s) => !line.serialItemIds.includes(s)))
    )
      fail("Choose the reserved serial numbers that actually arrived.");
    if (line.trackingType !== "serial" && selected.length)
      fail("This product does not use serial numbers.");
    const lotId = line.lotId;
    const [balance, target, quarantine, product, lot, ...serials] =
      await tx.getAll(
        db.doc(
          `inventoryBalances/${balanceDocumentId(actor.organizationId, line.productId, source!.id, lotId)}`,
        ),
        db.doc(
          `inventoryBalances/${balanceDocumentId(actor.organizationId, line.productId, destination!.id, lotId)}`,
        ),
        db.doc(
          `inventoryBalances/${balanceDocumentId(actor.organizationId, line.productId, damaged!.id, lotId)}`,
        ),
        db.doc(`products/${line.productId}`),
        db.doc(lotId ? `inventoryLots/${lotId}` : `products/${line.productId}`),
        ...releasedIds.map((s) => db.doc(`serializedItems/${s}`)),
      );
    if (
      !product!.exists ||
      product!.get("organizationId") !== actor.organizationId ||
      product!.get("trackingType") !== line.trackingType
    )
      fail("Product tracking changed; ask the administrator to review it.");
    for (const stock of [balance!, target!, quarantine!]) {
      if (
        stock.exists &&
        (stock.get("organizationId") !== actor.organizationId ||
          stock.get("productId") !== line.productId ||
          !["onHandQuantity", "reservedQuantity", "totalValueMinor"].every(
            (field) =>
              Number.isSafeInteger(num(stock, field)) && num(stock, field) >= 0,
          ) ||
          num(stock, "reservedQuantity") > num(stock, "onHandQuantity"))
      )
        fail("The stock balance needs administrator review.");
    }
    const heldDelta = approval
      ? approval.quantity
      : -(
          received +
          bad +
          lost +
          (transfer.status === "requested" ? 0 : cancel)
        );
    const reserved = num(balance!, "reservedQuantity") + heldDelta;
    const moved = received + bad + lost;
    if (
      (approval?.quantity ?? 0) >
        num(balance!, "onHandQuantity") - num(balance!, "reservedQuantity") ||
      reserved < 0 ||
      num(balance!, "onHandQuantity") - moved < reserved
    )
      fail(
        `There is not enough available ${line.productName}. Refresh stock and review the quantity.`,
      );
    for (const serial of serials)
      if (
        !serial.exists ||
        serial.get("organizationId") !== actor.organizationId ||
        serial.get("productId") !== line.productId ||
        serial.get("currentLocationId") !== source!.id ||
        (approving
          ? !["available", "at_branch"].includes(serial.get("status")) ||
            Boolean(serial.get("reservedTransferId"))
          : serial.get("reservedTransferId") !== transfer.id)
      )
        fail(
          "A selected serial number is no longer available for this transfer.",
        );
    if (
      lotId &&
      (!lot!.exists ||
        lot!.get("organizationId") !== actor.organizationId ||
        lot!.get("productId") !== line.productId ||
        Number(lot!.get("locationQuantities")?.[source!.id] ?? 0) < moved)
    )
      fail("The selected lot does not have enough stock.");
    if (approval) {
      line.approved = approval.quantity;
      line.serialItemIds = selected;
      if (line.trackingType === "serial")
        line.serialNumbers = Object.fromEntries(
          serials.map((s) => [s.id, String(s.get("serialNumber"))]),
        );
      if (lotId) line.lotNumber = String(lot!.get("lotNumber"));
    } else {
      line.received += received;
      line.damaged += bad;
      line.cancelled += cancel;
      line.writtenOff += lost;
      line.serialItemIds = line.serialItemIds.filter(
        (s) => !releasedIds.includes(s),
      );
    }
    plans.push({
      line,
      balance: balance!,
      target: target!,
      quarantine: quarantine!,
      product: product!,
      lot: lot!,
      serials,
      reserved,
      received,
      bad,
      lost,
      moved,
      approval,
    });
  }
  if (approving && !next.some((l) => l.approved))
    fail("Approve at least one unit, or cancel the request.");
  if (input.action === "receive" && !plans.some((p) => p.moved) && !input.note)
    fail("Enter the quantities received, or describe the problem.");
  const requestWrite = transfer.sourceRequestId
    ? await linkRequest(
        tx,
        actor,
        transfer.sourceRequestId,
        transfer.destinationBranchId,
        next,
        "update",
        transfer.items,
        transfer.status === "requested",
      )
    : null;
  let damageAreaNeeded = false;
  for (const p of plans) {
    const { line, balance, target, quarantine, serials } = p;
    const transactionId = randomUUID();
    const effectiveAt = Timestamp.fromDate(new Date(now));
    if (p.approval || !p.moved) {
      if (balance.exists)
        tx.update(balance.ref, {
          reservedQuantity: p.reserved,
          availableQuantity: num(balance, "onHandQuantity") - p.reserved,
          version: num(balance, "version") + 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
    }
    for (const serial of serials) {
      const good =
        input.action === "receive" &&
        input.lines
          .find((l) => l.id === line.id)!
          .serialItemIds.includes(serial.id);
      tx.update(
        serial.ref,
        p.approval
          ? {
              status: "reserved",
              reservedTransferId: transfer.id,
              updatedAt: FieldValue.serverTimestamp(),
            }
          : {
              status: p.lost
                ? "written_off"
                : p.moved
                  ? good
                    ? "at_branch"
                    : "damaged"
                  : source!.get("type") === "branch"
                    ? "at_branch"
                    : "available",
              currentLocationId:
                p.moved && !p.lost
                  ? good
                    ? destination!.id
                    : damaged!.id
                  : source!.id,
              warehouseId: p.moved
                ? FieldValue.delete()
                : (source!.get("warehouseId") ?? FieldValue.delete()),
              branchId:
                p.moved && !p.lost
                  ? transfer.destinationBranchId
                  : (source!.get("branchId") ?? FieldValue.delete()),
              active: !p.lost,
              reservedTransferId: FieldValue.delete(),
              reservationId: FieldValue.delete(),
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: actor.userId,
              ...(p.moved
                ? {
                    lastTransactionId: transactionId,
                    lastMovementAt: effectiveAt,
                  }
                : {}),
            },
      );
    }
    if (!p.moved) continue;
    const transactionNumber = `STOCK-${transactionId.slice(0, 8).toUpperCase()}`;
    const sourceValue = num(balance, "totalValueMinor"),
      sourceQuantity = num(balance, "onHandQuantity");
    // Allocate the final-unit rounding remainder as well: inventory value is conserved exactly.
    const totalValue =
      line.trackingType === "serial"
        ? serials.reduce((sum, s) => sum + num(s, "currentUnitCostMinor"), 0)
        : p.moved === sourceQuantity
          ? sourceValue
          : Math.round((sourceValue * p.moved) / sourceQuantity);
    if (
      !Number.isSafeInteger(totalValue) ||
      totalValue < 0 ||
      totalValue > sourceValue
    )
      fail("Stock valuation needs administrator review.");
    const goodIds =
      input.action === "receive"
        ? input.lines.find((l) => l.id === line.id)!.serialItemIds
        : [];
    const goodValue =
      line.trackingType === "serial"
        ? serials
            .filter((s) => goodIds.includes(s.id))
            .reduce((sum, s) => sum + num(s, "currentUnitCostMinor"), 0)
        : Math.round((totalValue * p.received) / p.moved);
    const badValue = p.lost ? 0 : totalValue - goodValue;
    const base = clean({
      organizationId: actor.organizationId,
      transactionId,
      transactionNumber,
      transactionType: "stock_transfer_receipt",
      productId: line.productId,
      sku: line.sku,
      productName: line.productName,
      trackingType: line.trackingType,
      lotId: line.lotId,
      currency: "NGN",
      transferId: transfer.id,
      referenceNumber: transfer.number,
      unitCostMinor: Math.round(totalValue / p.moved),
      effectiveAt,
      createdAt: FieldValue.serverTimestamp(),
      postedBy: actor.userId,
      reason:
        input.action === "resolve" ? input.note : "Destination acknowledgement",
    });
    const writeBalance = (
      doc: DocumentSnapshot,
      location: DocumentSnapshot,
      qty: number,
      value: number,
      held: number,
    ) => {
      if (!Number.isSafeInteger(value) || value < 0)
        fail("Stock valuation is out of range.");
      tx.set(
        doc.ref,
        clean({
          ...doc.data(),
          organizationId: actor.organizationId,
          productId: line.productId,
          sku: line.sku,
          productName: line.productName,
          trackingType: line.trackingType,
          locationId: location.id,
          branchId:
            location.id === damaged!.id
              ? transfer.destinationBranchId
              : location.get("branchId"),
          warehouseId: location.get("warehouseId"),
          lotId: line.lotId,
          onHandQuantity: qty,
          reservedQuantity: held,
          availableQuantity: qty - held,
          totalValueMinor: value,
          averageUnitCostMinor: qty ? Math.round(value / qty) : 0,
          currency: "NGN",
          version: num(doc, "version") + 1,
          lastTransactionId: transactionId,
          lastMovementAt: effectiveAt,
          createdAt: doc.get("createdAt") ?? FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }),
      );
    };
    const entry = (
      location: DocumentSnapshot | null,
      qty: number,
      value: number,
      before: number,
      serialId?: string,
    ) =>
      tx.create(
        db.collection("inventoryEntries").doc(),
        clean({
          ...base,
          locationId: location?.id,
          branchId:
            location?.id === damaged!.id
              ? transfer.destinationBranchId
              : location?.get("branchId"),
          warehouseId: location?.get("warehouseId"),
          externalAccount: location ? undefined : "inventory_loss",
          quantityDelta: qty,
          valueDeltaMinor: value,
          balanceBefore: before,
          balanceAfter: before + qty,
          serializedItemId: serialId,
        }),
      );
    writeBalance(
      balance,
      source!,
      sourceQuantity - p.moved,
      sourceValue - totalValue,
      p.reserved,
    );
    if (p.received)
      writeBalance(
        target,
        destination!,
        num(target, "onHandQuantity") + p.received,
        num(target, "totalValueMinor") + goodValue,
        num(target, "reservedQuantity"),
      );
    if (p.bad) {
      damageAreaNeeded = true;
      writeBalance(
        quarantine,
        damaged!,
        num(quarantine, "onHandQuantity") + p.bad,
        num(quarantine, "totalValueMinor") + badValue,
        num(quarantine, "reservedQuantity"),
      );
    }
    if (line.trackingType === "serial") {
      let goodIndex = 0,
        badIndex = 0;
      serials.forEach((serial, index) => {
        const value = num(serial, "currentUnitCostMinor");
        const good = goodIds.includes(serial.id);
        entry(source!, -1, -value, sourceQuantity - index, serial.id);
        entry(
          p.lost ? null : good ? destination! : damaged!,
          1,
          value,
          p.lost
            ? 0
            : good
              ? num(target, "onHandQuantity") + goodIndex++
              : num(quarantine, "onHandQuantity") + badIndex++,
          serial.id,
        );
      });
    } else {
      entry(source!, -p.moved, -totalValue, sourceQuantity);
      if (p.received)
        entry(
          destination!,
          p.received,
          goodValue,
          num(target, "onHandQuantity"),
        );
      if (p.bad)
        entry(damaged!, p.bad, badValue, num(quarantine, "onHandQuantity"));
      if (p.lost) entry(null, p.lost, totalValue, 0);
    }
    if (line.lotId) {
      const quantities = { ...p.lot.get("locationQuantities") } as Record<
        string,
        number
      >;
      quantities[source!.id] = (quantities[source!.id] ?? 0) - p.moved;
      if (p.received)
        quantities[destination!.id] =
          (quantities[destination!.id] ?? 0) + p.received;
      if (p.bad)
        quantities[damaged!.id] = (quantities[damaged!.id] ?? 0) + p.bad;
      tx.update(p.lot.ref, {
        locationQuantities: quantities,
        remainingQuantity: Object.values(quantities).reduce(
          (sum, n) => sum + n,
          0,
        ),
        lastTransactionId: transactionId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    tx.create(db.doc(`inventoryTransactions/${transactionId}`), {
      organizationId: actor.organizationId,
      transactionNumber,
      transactionType: "stock_transfer_receipt",
      status: "posted",
      referenceType: "stockTransfer",
      referenceId: transfer.id,
      referenceNumber: transfer.number,
      transferId: transfer.id,
      sourceLocationId: source!.id,
      destinationLocationId: p.lost ? null : destination!.id,
      sourceBranchId: transfer.sourceBranchId ?? null,
      sourceWarehouseId: transfer.sourceWarehouseId ?? null,
      destinationBranchId: transfer.destinationBranchId,
      effectiveAt,
      postedAt: FieldValue.serverTimestamp(),
      postedBy: actor.userId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actor.userId,
      reason:
        input.action === "resolve"
          ? input.note
          : "Confirmed destination receipt",
    });
    tx.create(db.collection("stockTransferReceipts").doc(), {
      organizationId: actor.organizationId,
      transferId: transfer.id,
      lineId: line.id,
      productId: line.productId,
      received: p.received,
      damaged: p.bad,
      writtenOff: p.lost,
      transactionId,
      createdAt: now,
      receivedBy: actor.userId,
    });
  }
  if (damageAreaNeeded && !damaged!.exists)
    tx.create(damaged!.ref, {
      organizationId: actor.organizationId,
      branchId: transfer.destinationBranchId,
      name: `${transfer.destinationName} damaged stock`,
      type: "damaged",
      status: "active",
      systemManaged: true,
      createdAt: FieldValue.serverTimestamp(),
    });
  requestWrite?.();
  const remaining = next.reduce(
    (sum, l) => sum + Math.max(0, pendingStock(l)),
    0,
  );
  const note = input.action === "receive" ? input.note : "";
  const status =
    transfer.status === "requested" && !approving
      ? "cancelled"
      : note ||
          (next.some((l) => l.damaged || l.writtenOff) &&
            input.action !== "resolve")
        ? "problem"
        : remaining === 0
          ? "completed"
          : next.some((l) => l.received || l.damaged)
            ? "partially_received"
            : "awaiting_receipt";
  tx.update(
    db.doc(`stockTransfers/${transfer.id}`),
    clean({
      items: next,
      status,
      problemNote: note,
      version: transfer.version + 1,
      approvedBy: approving ? actor.userId : transfer.approvedBy,
      approvedAt: approving ? now : undefined,
      updatedAt: now,
      completedAt: status === "completed" ? now : undefined,
    }),
  );
}
