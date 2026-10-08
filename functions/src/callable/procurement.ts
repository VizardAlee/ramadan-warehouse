import { AggregateField, FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import {
  accountingPeriodReference,
  assertAccountingPeriodOpen,
} from "../accounting/period-lock.js";
import { bankAccountSummary, resolveSettlementAccount } from "../accounting/settlement-account.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import {
  canSelfAuthorize,
  hasRole,
  hasServerPermission,
  requireAccess,
  requireBranchScope,
  requirePermission,
  requireWarehouseScope,
} from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import {
  normalizeInventoryIdentifier,
  uniquenessDocumentId,
} from "../inventory/calculations.js";
import { postInventoryTransaction } from "../inventory/post-inventory-transaction.js";
import { assertBalancedJournal } from "../sales/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import {
  createPurchaseOrderInput,
  procurementWorkspaceInput,
  purchaseOrderActionInput,
  receivePurchaseOrderItemInput,
  recordSupplierPaymentInput,
  saveSupplierInput,
  submitSupplierInvoiceInput,
  supplierInvoiceActionInput,
} from "../validation/procurement.js";

const accountNames: Readonly<Record<string, string>> = {
  "1010": "Cash on hand",
  "1020": "Card clearing",
  "1030": "Bank transfer clearing",
  "1200": "Inventory asset",
  "1250": "Supplier advances and credits",
  "1300": "Input VAT recoverable",
  "2000": "Accounts payable",
};
function supplierMoney(value: unknown) {
  const amount = value ?? 0;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)
    throw new HttpsError("failed-precondition", "Supplier balances require reconciliation before posting.");
  return amount;
}
function clean(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );
}
type ProcurementLocationScope = {
  branchId?: string;
  warehouseId?: string;
};
function requireProcurementScope(
  actor: Awaited<ReturnType<typeof requireAccess>>,
  scope: ProcurementLocationScope,
) {
  if (scope.branchId) return requireBranchScope(actor, scope.branchId);
  if (scope.warehouseId) return requireWarehouseScope(actor, scope.warehouseId);
  throw new HttpsError(
    "failed-precondition",
    "The procurement record has no operating location.",
  );
}
function procurementScopeFrom(
  snapshot: FirebaseFirestore.DocumentSnapshot,
): ProcurementLocationScope {
  return {
    branchId:
      typeof snapshot.get("branchId") === "string"
        ? String(snapshot.get("branchId"))
        : undefined,
    warehouseId:
      typeof snapshot.get("warehouseId") === "string"
        ? String(snapshot.get("warehouseId"))
        : undefined,
  };
}
function year() {
  return new Date().getUTCFullYear();
}

async function purchaseReceiptWorkspace(actor: Awaited<ReturnType<typeof requireAccess>>, input: ReturnType<typeof procurementWorkspaceInput.parse>) {
  const order = await db.doc(`purchaseOrders/${input.purchaseOrderId!}`).get();
  if (!order.exists || order.get("organizationId") !== actor.organizationId)
    throw new HttpsError("permission-denied", "Purchase order is unavailable.");
  const scope = procurementScopeFrom(order);
  requireProcurementScope(actor, scope);
  if ((input.branchId && input.branchId !== scope.branchId) || (input.warehouseId && input.warehouseId !== scope.warehouseId))
    throw new HttpsError("permission-denied", "The order belongs to another recording store.");
  const validReceipt = (receipt: FirebaseFirestore.DocumentSnapshot) => receipt.exists && receipt.get("organizationId") === actor.organizationId && receipt.get("purchaseOrderId") === order.id;
  const row = (receipt: FirebaseFirestore.DocumentSnapshot, movement?: FirebaseFirestore.DocumentSnapshot) => ({
    id: receipt.id,
    receiptNumber: receipt.get("receiptNumber") ?? `GRN-${movement?.get("transactionNumber") ?? receipt.id}`,
    productName: receipt.get("productName") ?? "Recorded goods",
    quantity: receipt.get("quantity"), unitOfMeasure: receipt.get("unitOfMeasure") ?? "unit",
    receivedAt: receipt.get("receivedAt")?.toDate?.().toISOString() ?? "",
  });
  if (input.receiptId) {
    const receipt = await db.doc(`purchaseReceipts/${input.receiptId}`).get();
    if (!validReceipt(receipt)) throw new HttpsError("permission-denied", "Receipt is unavailable for this order.");
    if (!receipt.get("inventoryTransactionId") || !receipt.get("receivingLocationId"))
      throw new HttpsError("failed-precondition", "This older receipt needs its stock ledger reference reconciled before printing.");
    const [movement, organization, location, staff, item] = await db.getAll(
      db.doc(`inventoryTransactions/${receipt.get("inventoryTransactionId")}`), db.doc(`organizations/${actor.organizationId}`),
      db.doc(`inventoryLocations/${receipt.get("receivingLocationId")}`), db.doc(`users/${receipt.get("receivedBy")}`),
      db.doc(`purchaseOrderItems/${receipt.get("purchaseOrderItemId")}`),
    );
    if (!movement!.exists || movement!.get("organizationId") !== actor.organizationId || movement!.get("status") !== "posted" || movement!.get("transactionType") !== "inventory_receipt" || movement!.get("referenceId") !== order.id || movement!.get("destinationLocationId") !== receipt.get("receivingLocationId") || receipt.get("receivingLocationId") !== order.get("receivingLocationId"))
      throw new HttpsError("failed-precondition", "The receipt's posted stock movement needs reconciliation before printing.");
    const entries = await db.collection("inventoryEntries").where("organizationId", "==", actor.organizationId)
      .where("transactionId", "==", movement!.id).where("locationId", "==", receipt.get("receivingLocationId")).limit(5001).get();
    if (entries.size > 5000 || entries.docs.some((entry) => entry.get("productId") !== receipt.get("productId") || Number(entry.get("quantityDelta")) <= 0) || entries.docs.reduce((sum, entry) => sum + Number(entry.get("quantityDelta")), 0) !== Number(receipt.get("quantity")))
      throw new HttpsError("failed-precondition", "The receipt quantity and stock ledger need reconciliation before printing.");
    const lotIds = [...new Set(entries.docs.map((entry) => entry.get("lotId")).filter((id): id is string => typeof id === "string"))];
    const lot = lotIds.length === 1 ? await db.doc(`inventoryLots/${lotIds[0]!}`).get() : undefined;
    return { document: {
      ...row(receipt, movement), purchaseOrderNumber: order.get("purchaseOrderNumber"), supplierName: order.get("supplierName"),
      receivingStore: order.get("operationalLocationName") ?? order.get("branchName") ?? order.get("warehouseName") ?? "Recorded store",
      receivingLocationName: receipt.get("receivingLocationName") ?? (location!.get("organizationId") === actor.organizationId ? location!.get("name") : "Recorded stock location"),
      receivedByName: receipt.get("receivedByName") ?? (staff!.get("organizationId") === actor.organizationId ? staff!.get("displayName") : null) ?? "Authorized receiving staff",
      unitOfMeasure: receipt.get("unitOfMeasure") ?? (item!.get("purchaseOrderId") === order.id ? item!.get("unitOfMeasure") : null) ?? "unit",
      inventoryReference: movement!.get("transactionNumber"), supplierReference: receipt.get("supplierReference") ?? null,
      serialNumbers: entries.docs.map((entry) => entry.get("serialNumber")).filter((serial): serial is string => typeof serial === "string"),
      lotNumber: receipt.get("lotNumber") ?? (lot?.get("organizationId") === actor.organizationId ? lot.get("lotNumber") : null) ?? null,
      notes: receipt.get("notes") ?? null,
      organization: { legalName: organization!.get("legalName") ?? organization!.get("name") ?? "Organization", tradingName: organization!.get("tradingName") ?? null,
        address: organization!.get("address") ?? null, contactEmail: organization!.get("contactEmail") ?? null, phoneNumbers: organization!.get("phoneNumbers") ?? [] },
    } };
  }
  let query = db.collection("purchaseReceipts").where("organizationId", "==", actor.organizationId).where("purchaseOrderId", "==", order.id)
    .orderBy("receivedAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (input.cursor) {
    const cursor = await db.doc(`purchaseReceipts/${input.cursor}`).get();
    if (!validReceipt(cursor)) throw new HttpsError("invalid-argument", "Restart receiving history after changing orders.");
    query = query.startAfter(cursor);
  }
  const pageSize = Math.min(input.limit, 100), result = await query.limit(pageSize + 1).get(), receipts = result.docs.slice(0, pageSize);
  const references = [...new Set(receipts.map((receipt) => receipt.get("inventoryTransactionId")).filter((id): id is string => typeof id === "string" && id.length > 0))];
  const movements = references.length ? await db.getAll(...references.map((id) => db.doc(`inventoryTransactions/${id}`))) : [];
  const byId = new Map(movements.filter((movement) => movement.get("organizationId") === actor.organizationId).map((movement) => [movement.id, movement]));
  return { receipts: receipts.map((receipt) => row(receipt, byId.get(String(receipt.get("inventoryTransactionId"))))), nextCursor: result.size > pageSize ? receipts.at(-1)!.id : null };
}
function sequenceNumber(prefix: string, sequence: number) {
  return `${prefix}-${year()}-${String(sequence).padStart(6, "0")}`;
}
function invoiceCounterId(organizationId: string, purchaseOrderItemId: string) {
  return uniquenessDocumentId(
    organizationId,
    "purchaseInvoiceItem",
    purchaseOrderItemId,
  );
}
function journalLines(
  netAmountMinor: number,
  vatAmountMinor: number,
  creditAccount: string,
) {
  const lines = [
    { accountCode: "1200", debitMinor: netAmountMinor, creditMinor: 0 },
    { accountCode: "1300", debitMinor: vatAmountMinor, creditMinor: 0 },
    {
      accountCode: creditAccount,
      debitMinor: 0,
      creditMinor: netAmountMinor + vatAmountMinor,
    },
  ].filter((line) => line.debitMinor || line.creditMinor);
  assertBalancedJournal(lines);
  return lines;
}
function writeJournal(
  transaction: FirebaseFirestore.Transaction,
  actor: Awaited<ReturnType<typeof requireAccess>>,
  values: {
    journal: FirebaseFirestore.DocumentReference;
    journalCounter: FirebaseFirestore.DocumentReference;
    journalCounterValue: number;
    journalType: string;
    referenceType: string;
    referenceId: string;
    referenceNumber: string;
    description: string;
    branchId?: string;
    warehouseId?: string;
    effectiveAt: Timestamp;
    lines: Array<{
      accountCode: string;
      accountName?: string;
      debitMinor: number;
      creditMinor: number;
    }>;
  },
) {
  const now = FieldValue.serverTimestamp();
  const journalNumber = sequenceNumber("JRN", values.journalCounterValue);
  transaction.set(values.journalCounter, {
    organizationId: actor.organizationId,
    kind: "journalEntry",
    value: values.journalCounterValue,
    updatedAt: now,
  });
  transaction.create(
    values.journal,
    clean({
      organizationId: actor.organizationId,
      branchId: values.branchId,
      warehouseId: values.warehouseId,
      journalNumber,
      journalType: values.journalType,
      status: "posted",
      referenceType: values.referenceType,
      referenceId: values.referenceId,
      referenceNumber: values.referenceNumber,
      description: values.description,
      totalDebitMinor: values.lines.reduce(
        (sum, line) => sum + line.debitMinor,
        0,
      ),
      totalCreditMinor: values.lines.reduce(
        (sum, line) => sum + line.creditMinor,
        0,
      ),
      currency: "NGN",
      effectiveAt: values.effectiveAt,
      postedAt: now,
      postedBy: actor.userId,
      createdAt: now,
    }),
  );
  for (const line of values.lines) {
    const account = db.doc(
      `chartOfAccounts/${uniquenessDocumentId(actor.organizationId, line.accountCode)}`,
    );
    transaction.set(
      account,
      {
        organizationId: actor.organizationId,
        code: line.accountCode,
        name: line.accountName ?? accountNames[line.accountCode] ?? line.accountCode,
        currency: "NGN",
        active: true,
        systemManaged: true,
        updatedAt: now,
      },
      { merge: true },
    );
    transaction.create(
      db.collection("journalLines").doc(),
      clean({
        organizationId: actor.organizationId,
        branchId: values.branchId,
        warehouseId: values.warehouseId,
        journalEntryId: values.journal.id,
        journalNumber,
        accountId: account.id,
        accountCode: line.accountCode,
        accountName: line.accountName ?? accountNames[line.accountCode] ?? line.accountCode,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        currency: "NGN",
        effectiveAt: values.effectiveAt,
        createdAt: now,
      }),
    );
  }
  return journalNumber;
}

export const saveSupplier = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "suppliers.manage");
  const input = parseInput(saveSupplierInput, request.data);
  const supplier = input.supplierId
    ? db.doc(`suppliers/${input.supplierId}`)
    : db.collection("suppliers").doc();
  const code = db.doc(
    `supplierCodes/${uniquenessDocumentId(actor.organizationId, normalizeInventoryIdentifier(input.name))}`,
  );
  const counter = db.doc(`supplierCounters/${actor.organizationId}`);
  const operation = db.doc(
    `idempotencyKeys/${actor.organizationId}_saveSupplier_${input.idempotencyKey}`,
  );
  let result = { supplierId: supplier.id, supplierNumber: "", saved: true };
  await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(
      operation,
      supplier,
      code,
      counter,
    );
    const previous = snapshots[0]!,
      current = snapshots[1]!,
      unique = snapshots[2]!,
      counterSnapshot = snapshots[3]!;
    if (previous.exists) {
      result = {
        supplierId: String(previous.get("entityId")),
        supplierNumber: String(previous.get("supplierNumber")),
        saved: false,
      };
      return;
    }
    if (
      current.exists &&
      current.get("organizationId") !== actor.organizationId
    )
      throw new HttpsError("permission-denied", "Supplier is unavailable.");
    if (unique.exists && unique.get("supplierId") !== supplier.id)
      throw new HttpsError(
        "already-exists",
        "A supplier with this name already exists.",
      );
    const sequence = current.exists
      ? Number(current.get("sequence"))
      : Number(counterSnapshot.get("value") ?? 0) + 1;
    const supplierNumber = current.exists
      ? String(current.get("supplierNumber"))
      : sequenceNumber("SUP", sequence);
    const now = FieldValue.serverTimestamp();
    if (!current.exists)
      transaction.set(
        counter,
        {
          organizationId: actor.organizationId,
          value: sequence,
          updatedAt: now,
        },
        { merge: true },
      );
    transaction.set(code, {
      organizationId: actor.organizationId,
      supplierId: supplier.id,
      normalizedName: normalizeInventoryIdentifier(input.name),
      updatedAt: now,
    });
    transaction.set(
      supplier,
      clean({
        organizationId: actor.organizationId,
        supplierNumber,
        sequence,
        name: input.name,
        phone: input.phone,
        email: input.email,
        address: input.address,
        taxId: input.taxId,
        paymentTermsDays: input.paymentTermsDays,
        active: input.active,
        outstandingBalanceMinor: Number(
          current.get("outstandingBalanceMinor") ?? 0,
        ),
        currency: "NGN",
        createdAt: current.exists ? current.get("createdAt") : now,
        createdBy: current.exists ? current.get("createdBy") : actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      }),
      { merge: true },
    );
    transaction.create(operation, {
      organizationId: actor.organizationId,
      action: "saveSupplier",
      entityId: supplier.id,
      supplierNumber,
      status: "completed",
      createdAt: now,
      createdBy: actor.userId,
    });
    writeAuditLog(transaction, actor, {
      action: current.exists ? "supplier.updated" : "supplier.created",
      entityType: "supplier",
      entityId: supplier.id,
      correlationId: correlationId(),
      sourceFunction: "saveSupplier",
      after: { supplierNumber, name: input.name, active: input.active },
    });
    result = { supplierId: supplier.id, supplierNumber, saved: true };
  });
  return result;
});

export const getProcurementWorkspace = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "procurement.read");
    const input = parseInput(procurementWorkspaceInput, request.data);
    if (input.branchId) requireBranchScope(actor, input.branchId);
    if (input.warehouseId) requireWarehouseScope(actor, input.warehouseId);
    if (input.view === "purchase_receipts") return purchaseReceiptWorkspace(actor, input);
    if (input.view === "supplier_account" || input.view === "supplier_payables") {
      requirePermission(actor, "payables.read");
      const organizationWide = ["system_administrator", "operations_administrator", "finance_officer", "auditor"].some((role) => hasRole(actor, role as Parameters<typeof hasRole>[1]));
      if (!organizationWide && !input.branchId && !input.warehouseId)
        throw new HttpsError("permission-denied", "Select an assigned store for supplier history.");
      const supplier = await db.doc(`suppliers/${input.supplierId}`).get();
      if (!supplier.exists || supplier.get("organizationId") !== actor.organizationId)
        throw new HttpsError("not-found", "Supplier not found.");
      if (input.view === "supplier_payables") {
        let invoices: FirebaseFirestore.Query = db.collection("supplierInvoices")
          .where("organizationId", "==", actor.organizationId).where("supplierId", "==", supplier.id)
          .where("status", "in", ["approved", "partially_paid"]);
        if (input.branchId) invoices = invoices.where("branchId", "==", input.branchId);
        if (input.warehouseId) invoices = invoices.where("warehouseId", "==", input.warehouseId);
        let page = invoices.orderBy(FieldPath.documentId());
        if (input.cursor) {
          const start = await db.doc(`supplierInvoices/${input.cursor}`).get();
          if (!start.exists || start.get("organizationId") !== actor.organizationId || start.get("supplierId") !== supplier.id ||
            !["approved", "partially_paid"].includes(String(start.get("status"))) ||
            (input.branchId && start.get("branchId") !== input.branchId) || (input.warehouseId && start.get("warehouseId") !== input.warehouseId))
            throw new HttpsError("invalid-argument", "Restart unpaid invoices after changing filters or settling an invoice.");
          page = page.startAfter(start);
        }
        const asOfDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        const daysAgo = (days: number) => new Date(Date.parse(`${asOfDate}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
        const windows = [
          { name: "Current", from: asOfDate, to: "9999-12-31" },
          { name: "1–30 days", from: daysAgo(30), to: daysAgo(1) },
          { name: "31–60 days", from: daysAgo(60), to: daysAgo(31) },
          { name: "61–90 days", from: daysAgo(90), to: daysAgo(61) },
          { name: "90+ days", from: "0001-01-01", to: daysAgo(91) },
        ];
        const [rows, total, aging] = await Promise.all([
          page.limit(Math.min(input.limit, 100) + 1).get(),
          invoices.aggregate({ amount: AggregateField.sum("outstandingAmountMinor") }).get(),
          Promise.all(windows.map(async (window) => {
            const value = await invoices.where("dueDate", ">=", window.from).where("dueDate", "<=", window.to)
              .aggregate({ amount: AggregateField.sum("outstandingAmountMinor") }).get();
            return { name: window.name, amountMinor: supplierMoney(value.data().amount) };
          })),
        ]);
        const totalOutstandingMinor = supplierMoney(total.data().amount);
        const undatedMinor = supplierMoney(totalOutstandingMinor - aging.reduce((sum, bucket) => sum + bucket.amountMinor, 0));
        const visible = rows.docs.slice(0, Math.min(input.limit, 100));
        return {
          asOfDate, totalOutstandingMinor, aging: [...aging, { name: "Due date not set", amountMinor: undatedMinor }],
          invoices: visible.map((invoice) => ({ id: invoice.id, ...invoice.data() })),
          nextCursor: rows.size > visible.length ? visible.at(-1)!.id : null,
          note: "Current approved unpaid invoices, not a historical balance. Aging uses Nigerian business dates. Missing historical due dates are not guessed; advances are separate assets.",
        };
      }
      let base: FirebaseFirestore.Query = db.collection("supplierAccountEntries")
        .where("organizationId", "==", actor.organizationId).where("supplierId", "==", supplier.id);
      if (input.branchId) base = base.where("branchId", "==", input.branchId);
      if (input.warehouseId) base = base.where("warehouseId", "==", input.warehouseId);
      const from = input.from ? Timestamp.fromDate(new Date(`${input.from}T00:00:00+01:00`)) : undefined;
      const through = input.through ? Timestamp.fromDate(new Date(`${input.through}T23:59:59.999+01:00`)) : undefined;
      let period = base;
      if (from) period = period.where("effectiveAt", ">=", from);
      if (through) period = period.where("effectiveAt", "<=", through);
      // Keep sums separate: older payable entries have no advanceAmountMinor.
      // A multi-field aggregate would exclude those historical documents.
      const sumBalances = async (query: FirebaseFirestore.Query) => {
        const [payable, advance] = await Promise.all([
          query.aggregate({ value: AggregateField.sum("amountMinor") }).get(),
          query.aggregate({ value: AggregateField.sum("advanceAmountMinor") }).get(),
        ]);
        return { payable: payable.data().value, advance: advance.data().value };
      };
      let page = period.orderBy("effectiveAt", "desc").orderBy(FieldPath.documentId(), "desc");
      if (input.cursor) {
        const cursor = await db.doc(`supplierAccountEntries/${input.cursor}`).get();
        if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId || cursor.get("supplierId") !== supplier.id ||
          (input.branchId && cursor.get("branchId") !== input.branchId) || (input.warehouseId && cursor.get("warehouseId") !== input.warehouseId) ||
          (from && cursor.get("effectiveAt").toMillis() < from.toMillis()) || (through && cursor.get("effectiveAt").toMillis() > through.toMillis()))
          throw new HttpsError("invalid-argument", "Restart supplier history after changing filters.");
        page = page.startAfter(cursor);
      }
      const [entries, totals, opening] = await Promise.all([
        page.limit(Math.min(input.limit, 100) + 1).get(), sumBalances(period),
        from ? sumBalances(base.where("effectiveAt", "<", from)) : Promise.resolve(null),
      ]);
      const openingPayable = opening?.payable ?? 0, openingAdvance = opening?.advance ?? 0;
      const closingPayable = openingPayable + totals.payable, closingAdvance = openingAdvance + totals.advance;
      if (![openingPayable, openingAdvance, closingPayable, closingAdvance].every(Number.isSafeInteger))
        throw new HttpsError("failed-precondition", "Supplier statement totals require reconciliation.");
      const documents = entries.docs.slice(0, Math.min(input.limit, 100));
      return {
        supplier: clean({ id: supplier.id, name: supplier.get("name"), supplierNumber: supplier.get("supplierNumber"),
          ...(organizationWide ? { outstandingBalanceMinor: supplierMoney(supplier.get("outstandingBalanceMinor")), advanceBalanceMinor: supplierMoney(supplier.get("advanceBalanceMinor")) } : {}) }),
        entries: documents.map((entry) => ({ id: entry.id, ...entry.data() })),
        openingPayableMinor: openingPayable, closingPayableMinor: closingPayable,
        openingAdvanceMinor: openingAdvance, closingAdvanceMinor: closingAdvance,
        nextCursor: entries.size > documents.length ? documents.at(-1)!.id : null,
        scopeNote: input.branchId || input.warehouseId ? "Store-filtered ledger activity. Older organization-wide payments without a location are excluded; consolidated balances may differ." : "Consolidated supplier ledger activity. Compare with current control balances before external use.",
      };
    }
    const scopedQuery = (collection: string, limit: number) => {
      let query: FirebaseFirestore.Query = db
        .collection(collection)
        .where("organizationId", "==", actor.organizationId);
      if (input.branchId) query = query.where("branchId", "==", input.branchId);
      if (input.warehouseId)
        query = query.where("warehouseId", "==", input.warehouseId);
      return query.limit(limit);
    };
    const purchaseOrdersQuery = scopedQuery("purchaseOrders", input.limit);
    const purchaseItemsQuery = scopedQuery("purchaseOrderItems", 500);
    const invoicesQuery = scopedQuery("supplierInvoices", input.limit);
    const [
      suppliers,
      branches,
      warehouses,
      locations,
      products,
      purchaseOrders,
      purchaseOrderItems,
      invoices,
      bankAccounts,
    ] = await Promise.all([
      db
        .collection("suppliers")
        .where("organizationId", "==", actor.organizationId)
        .limit(200)
        .get(),
      db
        .collection("branches")
        .where("organizationId", "==", actor.organizationId)
        .where("status", "==", "active")
        .limit(100)
        .get(),
      db
        .collection("warehouses")
        .where("organizationId", "==", actor.organizationId)
        .where("status", "==", "active")
        .limit(100)
        .get(),
      db
        .collection("inventoryLocations")
        .where("organizationId", "==", actor.organizationId)
        .where("status", "==", "active")
        .limit(300)
        .get(),
      db
        .collection("products")
        .where("organizationId", "==", actor.organizationId)
        .where("active", "==", true)
        .limit(500)
        .get(),
      purchaseOrdersQuery.get(),
      purchaseItemsQuery.get(),
      invoicesQuery.get(),
      db.collection("bankAccounts")
        .where("organizationId", "==", actor.organizationId)
        .where("active", "==", true)
        .limit(100)
        .get(),
    ]);
    const organizationWide =
      hasRole(actor, "system_administrator") ||
      hasRole(actor, "operations_administrator") ||
      hasRole(actor, "finance_officer") ||
      hasRole(actor, "auditor");
    const visible = (document: FirebaseFirestore.DocumentSnapshot) =>
      organizationWide ||
      (typeof document.get("branchId") === "string" &&
        actor.branchIds.includes(String(document.get("branchId")))) ||
      (typeof document.get("warehouseId") === "string" &&
        actor.warehouseIds.includes(String(document.get("warehouseId"))));
    return {
      suppliers: suppliers.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      })),
      bankAccounts: bankAccounts.docs.map(bankAccountSummary),
      branches: branches.docs
        .filter(
          (document) => organizationWide || actor.branchIds.includes(document.id),
        )
        .map((document) => ({
          id: document.id,
          name: document.get("name"),
          code: document.get("code"),
          branchType: document.get("branchType") ?? "store",
        })),
      warehouses: warehouses.docs
        .filter(
          (document) =>
            organizationWide || actor.warehouseIds.includes(document.id),
        )
        .map((document) => ({
          id: document.id,
          name: document.get("name"),
          code: document.get("code"),
        })),
      locations: locations.docs
        .filter(visible)
        .map((document) => ({
          id: document.id,
          branchId: document.get("branchId"),
          warehouseId: document.get("warehouseId"),
          name: document.get("name"),
          code: document.get("code"),
        })),
      products: products.docs.map((document) => ({
        id: document.id,
        name: document.get("name"),
        sku: document.get("sku"),
        trackingType: document.get("trackingType"),
        unitOfMeasure: document.get("unitOfMeasure"),
      })),
      purchaseOrders: purchaseOrders.docs
        .filter(visible)
        .map((document) => ({ id: document.id, ...document.data() })),
      purchaseOrderItems: purchaseOrderItems.docs
        .filter(visible)
        .map((document) => ({ id: document.id, ...document.data() })),
      supplierInvoices: hasServerPermission(actor, "payables.read")
        ? invoices.docs
            .filter(visible)
            .map((document) => ({ id: document.id, ...document.data() }))
        : [],
    };
  },
);

export const createPurchaseOrder = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "procurement.create");
    const input = parseInput(createPurchaseOrderInput, request.data);
    requireProcurementScope(actor, input);
    const ownerType = input.branchId ? "branch" : "warehouse";
    const ownerId = input.branchId ?? input.warehouseId!;
    const supplier = db.doc(`suppliers/${input.supplierId}`),
      owner = db.doc(
        `${ownerType === "branch" ? "branches" : "warehouses"}/${ownerId}`,
      ),
      receivingLocation = db.doc(
        `inventoryLocations/${input.receivingLocationId}`,
      );
    const products = input.lines.map((line) =>
      db.doc(`products/${line.productId}`),
    );
    const counter = db.doc(`purchaseOrderCounters/${actor.organizationId}`),
      purchaseOrder = db.collection("purchaseOrders").doc();
    const operation = db.doc(
      `idempotencyKeys/${actor.organizationId}_createPurchaseOrder_${input.idempotencyKey}`,
    );
    let result = {
      purchaseOrderId: purchaseOrder.id,
      purchaseOrderNumber: "",
      created: true,
    };
    await db.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(
        operation,
        supplier,
        owner,
        receivingLocation,
        counter,
        ...products,
      );
      let cursor = 0;
      const previous = snapshots[cursor++]!,
        supplierSnapshot = snapshots[cursor++]!,
        ownerSnapshot = snapshots[cursor++]!,
        locationSnapshot = snapshots[cursor++]!,
        counterSnapshot = snapshots[cursor++]!;
      if (previous.exists) {
        result = {
          purchaseOrderId: String(previous.get("entityId")),
          purchaseOrderNumber: String(previous.get("purchaseOrderNumber")),
          created: false,
        };
        return;
      }
      if (
        !supplierSnapshot.exists ||
        supplierSnapshot.get("organizationId") !== actor.organizationId ||
        supplierSnapshot.get("active") !== true
      )
        throw new HttpsError(
          "failed-precondition",
          "Select an active supplier.",
        );
      if (
        !ownerSnapshot.exists ||
        ownerSnapshot.get("organizationId") !== actor.organizationId ||
        ownerSnapshot.get("status") !== "active"
      )
        throw new HttpsError(
          "failed-precondition",
          "Receiving operating location is unavailable.",
        );
      if (
        !locationSnapshot.exists ||
        locationSnapshot.get("organizationId") !== actor.organizationId ||
        locationSnapshot.get(`${ownerType}Id`) !== ownerId ||
        locationSnapshot.get("status") !== "active"
      )
        throw new HttpsError(
          "failed-precondition",
          "Select an active stock location inside the receiving location.",
        );
      const productSnapshots = snapshots.slice(cursor);
      const calculated = input.lines.map((line, index) => {
        const product = productSnapshots[index]!;
        if (
          !product.exists ||
          product.get("organizationId") !== actor.organizationId ||
          product.get("active") !== true
        )
          throw new HttpsError(
            "failed-precondition",
            "A purchase product is unavailable.",
          );
        const net = line.quantity * line.unitCostMinor,
          vat = Math.round((net * line.vatRateBasisPoints) / 10_000);
        return { line, product, net, vat, gross: net + vat };
      });
      const sequence = Number(counterSnapshot.get("value") ?? 0) + 1,
        purchaseOrderNumber = sequenceNumber(
          `PO-${String(ownerSnapshot.get("code"))}`,
          sequence,
        ),
        now = FieldValue.serverTimestamp();
      const total = (key: "net" | "vat" | "gross") =>
        calculated.reduce((sum, line) => sum + line[key], 0);
      transaction.set(
        counter,
        {
          organizationId: actor.organizationId,
          value: sequence,
          updatedAt: now,
        },
        { merge: true },
      );
      transaction.create(
        purchaseOrder,
        clean({
          organizationId: actor.organizationId,
          purchaseOrderNumber,
          sequence,
          supplierId: supplier.id,
          supplierNumber: supplierSnapshot.get("supplierNumber"),
          supplierName: supplierSnapshot.get("name"),
          branchId: input.branchId,
          branchName:
            ownerType === "branch" ? ownerSnapshot.get("name") : undefined,
          warehouseId: input.warehouseId,
          warehouseName:
            ownerType === "warehouse" ? ownerSnapshot.get("name") : undefined,
          operationalLocationType:
            ownerType === "branch"
              ? ownerSnapshot.get("branchType") === "head_office"
                ? "head_office"
                : "store"
              : "legacy_warehouse",
          operationalLocationId: owner.id,
          operationalLocationName: ownerSnapshot.get("name"),
          receivingLocationId: receivingLocation.id,
          receivingLocationName: locationSnapshot.get("name"),
          status: "draft",
          expectedAt: input.expectedAt
            ? Timestamp.fromDate(new Date(input.expectedAt))
            : undefined,
          notes: input.notes,
          netAmountMinor: total("net"),
          vatAmountMinor: total("vat"),
          grossAmountMinor: total("gross"),
          receivedNetAmountMinor: 0,
          invoicedNetAmountMinor: 0,
          currency: "NGN",
          createdAt: now,
          createdBy: actor.userId,
          updatedAt: now,
        }),
      );
      for (const line of calculated)
        transaction.create(db.collection("purchaseOrderItems").doc(), clean({
          organizationId: actor.organizationId,
          purchaseOrderId: purchaseOrder.id,
          purchaseOrderNumber,
          supplierId: supplier.id,
          branchId: input.branchId,
          warehouseId: input.warehouseId,
          operationalLocationType:
            ownerType === "branch"
              ? ownerSnapshot.get("branchType") === "head_office"
                ? "head_office"
                : "store"
              : "legacy_warehouse",
          operationalLocationId: owner.id,
          productId: line.product.id,
          sku: line.product.get("sku"),
          productName: line.product.get("name"),
          trackingType: line.product.get("trackingType"),
          unitOfMeasure: line.product.get("unitOfMeasure"),
          orderedQuantity: line.line.quantity,
          receivedQuantity: 0,
          unitCostMinor: line.line.unitCostMinor,
          vatRateBasisPoints: line.line.vatRateBasisPoints,
          netAmountMinor: line.net,
          vatAmountMinor: line.vat,
          grossAmountMinor: line.gross,
          currency: "NGN",
          createdAt: now,
        }));
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "createPurchaseOrder",
        entityId: purchaseOrder.id,
        purchaseOrderNumber,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: "purchase_order.created",
        entityType: "purchaseOrder",
        entityId: purchaseOrder.id,
        correlationId: correlationId(),
        sourceFunction: "createPurchaseOrder",
        after: clean({
          purchaseOrderNumber,
          supplierId: supplier.id,
          branchId: input.branchId,
          warehouseId: input.warehouseId,
          operationalLocationId: owner.id,
          grossAmountMinor: total("gross"),
        }),
      });
      result = {
        purchaseOrderId: purchaseOrder.id,
        purchaseOrderNumber,
        created: true,
      };
    });
    return result;
  },
);

async function purchaseOrderStatusAction(
  request: Parameters<typeof requireAccess>[0],
  action: "submit" | "approve",
) {
  const actor = await requireAccess(request);
  requirePermission(
    actor,
    action === "submit" ? "procurement.create" : "procurement.approve",
  );
  const input = parseInput(purchaseOrderActionInput, request.data),
    purchaseOrder = db.doc(`purchaseOrders/${input.purchaseOrderId}`);
  const initial = await purchaseOrder.get();
  if (!initial.exists || initial.get("organizationId") !== actor.organizationId)
    throw new HttpsError("not-found", "Purchase order not found.");
  requireProcurementScope(actor, procurementScopeFrom(initial));
  const operation = db.doc(
    `idempotencyKeys/${actor.organizationId}_${action}PurchaseOrder_${input.idempotencyKey}`,
  );
  await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(operation, purchaseOrder),
      previous = snapshots[0]!,
      current = snapshots[1]!;
    if (previous.exists) return;
    const expected = action === "submit" ? "draft" : "submitted";
    if (!current.exists || current.get("status") !== expected)
      throw new HttpsError(
        "failed-precondition",
        `Only a ${expected} purchase order can be ${action === "submit" ? "submitted" : "approved"}.`,
      );
    if (
      action === "approve" &&
      current.get("createdBy") === actor.userId &&
      !canSelfAuthorize(actor)
    )
      throw new HttpsError(
        "permission-denied",
        "This role cannot approve its own purchase order.",
        { code: "PURCHASE_ORDER_SELF_APPROVAL_FORBIDDEN" },
      );
    const now = FieldValue.serverTimestamp(),
      next = action === "submit" ? "submitted" : "approved";
    transaction.update(
      purchaseOrder,
      clean({
        status: next,
        [`${action}tedAt`]: now,
        [`${action}tedBy`]: actor.userId,
        approvalNotes: action === "approve" ? input.notes : undefined,
        updatedAt: now,
      }),
    );
    transaction.create(operation, {
      organizationId: actor.organizationId,
      action: `${action}PurchaseOrder`,
      entityId: purchaseOrder.id,
      status: "completed",
      createdAt: now,
      createdBy: actor.userId,
    });
    writeAuditLog(transaction, actor, {
      action: `purchase_order.${next}`,
      entityType: "purchaseOrder",
      entityId: purchaseOrder.id,
      correlationId: correlationId(),
      sourceFunction: `${action}PurchaseOrder`,
      after: { status: next },
    });
  });
  return {
    purchaseOrderId: purchaseOrder.id,
    status: action === "submit" ? "submitted" : "approved",
  };
}
export const submitPurchaseOrder = onCall({ enforceAppCheck }, (request) =>
  purchaseOrderStatusAction(request, "submit"),
);
export const approvePurchaseOrder = onCall({ enforceAppCheck }, (request) =>
  purchaseOrderStatusAction(request, "approve"),
);

export const receivePurchaseOrderItem = onCall(
  { enforceAppCheck, timeoutSeconds: 60 },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "procurement.receive");
    const input = parseInput(receivePurchaseOrderItemInput, request.data),
      purchaseOrder = db.doc(`purchaseOrders/${input.purchaseOrderId}`),
      item = db.doc(`purchaseOrderItems/${input.purchaseOrderItemId}`);
    const operation = db.doc(
      `idempotencyKeys/${actor.organizationId}_receivePurchaseOrderItem_${input.idempotencyKey}`,
    );
    const priorOperation = await operation.get();
    if (priorOperation.exists)
      return {
        receiptId: String(priorOperation.get("receiptId")),
        inventoryTransactionId: String(
          priorOperation.get("inventoryTransactionId"),
        ),
        posted: false,
      };
    const [orderSnapshot, itemSnapshot] = await Promise.all([
      purchaseOrder.get(),
      item.get(),
    ]);
    if (
      !orderSnapshot.exists ||
      orderSnapshot.get("organizationId") !== actor.organizationId ||
      !["approved", "partially_received"].includes(
        String(orderSnapshot.get("status")),
      )
    )
      throw new HttpsError(
        "failed-precondition",
        "Only an approved open purchase order can be received.",
      );
    requireProcurementScope(actor, procurementScopeFrom(orderSnapshot));
    if (
      !itemSnapshot.exists ||
      itemSnapshot.get("purchaseOrderId") !== purchaseOrder.id
    )
      throw new HttpsError(
        "invalid-argument",
        "Purchase-order item is unavailable.",
      );
    const receipt = db.collection("purchaseReceipts").doc();
    let previousReceipt: {
      receiptId: string;
      inventoryTransactionId: string;
      posted: boolean;
    } | null = null;
    await db.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(operation, item),
        previous = snapshots[0]!,
        current = snapshots[1]!;
      if (previous.exists) {
        previousReceipt = {
          receiptId: String(previous.get("receiptId")),
          inventoryTransactionId: String(
            previous.get("inventoryTransactionId"),
          ),
          posted: false,
        };
        return;
      }
      if (
        !current.exists ||
        current.get("purchaseOrderId") !== purchaseOrder.id
      )
        throw new HttpsError(
          "failed-precondition",
          "Purchase-order item changed.",
        );
      const inProgress = current.get("receiptInProgressKey");
      if (inProgress && inProgress !== input.idempotencyKey)
        throw new HttpsError(
          "aborted",
          "Another receipt is already being posted for this item.",
        );
      const remaining =
        Number(current.get("orderedQuantity")) -
        Number(current.get("receivedQuantity") ?? 0);
      if (input.quantity > remaining)
        throw new HttpsError(
          "failed-precondition",
          "Receipt quantity exceeds the outstanding ordered quantity.",
        );
      transaction.update(item, {
        receiptInProgressKey: input.idempotencyKey,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    if (previousReceipt) return previousReceipt;
    let inventoryResult: Awaited<ReturnType<typeof postInventoryTransaction>>;
    try {
      inventoryResult = await postInventoryTransaction(actor, {
        transactionType: "inventory_receipt",
        productId: String(itemSnapshot.get("productId")),
        quantity: input.quantity,
        destinationLocationId: String(orderSnapshot.get("receivingLocationId")),
        externalAccount: `supplier:${String(orderSnapshot.get("supplierId"))}`,
        unitCostMinor: Number(itemSnapshot.get("unitCostMinor")),
        serialNumbers: input.serialNumbers,
        lot: input.lot
          ? { ...input.lot, supplierReference: input.supplierReference }
          : undefined,
        effectiveAt: input.receivedAt,
        reason: `Purchase receipt ${String(orderSnapshot.get("purchaseOrderNumber"))}`,
        notes: input.notes,
        referenceType: "purchase_order",
        referenceId: purchaseOrder.id,
        referenceNumber: String(orderSnapshot.get("purchaseOrderNumber")),
        idempotencyKey: `purchase-${input.idempotencyKey}`,
        correlationId: correlationId(),
        sourceFunction: "receivePurchaseOrderItem",
      });
    } catch (error) {
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(item);
        if (current.get("receiptInProgressKey") === input.idempotencyKey)
          transaction.update(item, {
            receiptInProgressKey: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
      });
      throw error;
    }
    let result = {
      receiptId: receipt.id,
      inventoryTransactionId: inventoryResult.transactionId,
      posted: true,
    };
    const allItems = await db
      .collection("purchaseOrderItems")
      .where("purchaseOrderId", "==", purchaseOrder.id)
      .get();
    await db.runTransaction(async (transaction) => {
      const refs = allItems.docs.map((document) => document.ref),
        snapshots = await transaction.getAll(operation, purchaseOrder, ...refs);
      let cursor = 0;
      const previous = snapshots[cursor++]!,
        currentOrder = snapshots[cursor++]!,
        currentItems = snapshots.slice(cursor);
      if (previous.exists) {
        result = {
          receiptId: String(previous.get("receiptId")),
          inventoryTransactionId: String(
            previous.get("inventoryTransactionId"),
          ),
          posted: false,
        };
        return;
      }
      const targetIndex = refs.findIndex(
          (reference) => reference.id === item.id,
        ),
        target = currentItems[targetIndex]!;
      if (
        !target.exists ||
        target.get("receiptInProgressKey") !== input.idempotencyKey
      )
        throw new HttpsError(
          "aborted",
          "Purchase receipt finalization lost its item lock.",
        );
      const nextReceived =
        Number(target.get("receivedQuantity") ?? 0) + input.quantity;
      transaction.update(item, {
        receivedQuantity: nextReceived,
        receiptInProgressKey: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      const complete = currentItems.every(
        (snapshot, index) =>
          Number(snapshot.get("receivedQuantity") ?? 0) +
            (index === targetIndex ? input.quantity : 0) >=
          Number(snapshot.get("orderedQuantity")),
      );
      const netReceived = input.quantity * Number(target.get("unitCostMinor")),
        now = FieldValue.serverTimestamp();
      transaction.update(purchaseOrder, {
        status: complete ? "received" : "partially_received",
        receivedNetAmountMinor:
          Number(currentOrder.get("receivedNetAmountMinor") ?? 0) + netReceived,
        updatedAt: now,
      });
      transaction.create(
        receipt,
        clean({
          organizationId: actor.organizationId,
          purchaseOrderId: purchaseOrder.id,
          purchaseOrderNumber: currentOrder.get("purchaseOrderNumber"),
          purchaseOrderItemId: item.id,
          receiptNumber: `GRN-${inventoryResult.transactionNumber}`,
          supplierId: currentOrder.get("supplierId"),
          branchId: currentOrder.get("branchId"),
          warehouseId: currentOrder.get("warehouseId"),
          operationalLocationType: currentOrder.get("operationalLocationType"),
          operationalLocationId: currentOrder.get("operationalLocationId"),
          receivingLocationId: currentOrder.get("receivingLocationId"),
          productId: target.get("productId"),
          sku: target.get("sku"),
          productName: target.get("productName"),
          unitOfMeasure: target.get("unitOfMeasure"),
          receivingLocationName: currentOrder.get("receivingLocationName"),
          quantity: input.quantity,
          unitCostMinor: target.get("unitCostMinor"),
          netAmountMinor: netReceived,
          supplierReference: input.supplierReference,
          inventoryTransactionId: inventoryResult.transactionId,
          receivedAt: Timestamp.fromDate(new Date(input.receivedAt)),
          receivedBy: actor.userId,
          receivedByName: typeof request.auth?.token.name === "string" ? request.auth.token.name : undefined,
          lotNumber: input.lot?.lotNumber,
          notes: input.notes,
          createdAt: now,
        }),
      );
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "receivePurchaseOrderItem",
        entityId: purchaseOrder.id,
        receiptId: receipt.id,
        inventoryTransactionId: inventoryResult.transactionId,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: "purchase_order.received",
        entityType: "purchaseOrder",
        entityId: purchaseOrder.id,
        correlationId: correlationId(),
        sourceFunction: "receivePurchaseOrderItem",
        after: {
          purchaseOrderItemId: item.id,
          receiptId: receipt.id,
          receiptNumber: `GRN-${inventoryResult.transactionNumber}`,
          quantity: input.quantity,
          inventoryTransactionId: inventoryResult.transactionId,
        },
      });
    });
    return result;
  },
);

export const submitSupplierInvoice = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "payables.create");
    const input = parseInput(submitSupplierInvoiceInput, request.data),
      purchaseOrder = db.doc(`purchaseOrders/${input.purchaseOrderId}`);
    const order = await purchaseOrder.get();
    if (!order.exists || order.get("organizationId") !== actor.organizationId)
      throw new HttpsError("not-found", "Purchase order not found.");
    requireProcurementScope(actor, procurementScopeFrom(order));
    const itemRefs = input.lines.map((line) =>
      db.doc(`purchaseOrderItems/${line.purchaseOrderItemId}`),
    );
    const counterRefs = input.lines.map((line) =>
      db.doc(
        `purchaseInvoiceItemCounters/${invoiceCounterId(actor.organizationId, line.purchaseOrderItemId)}`,
      ),
    );
    const invoice = db.collection("supplierInvoices").doc(),
      operation = db.doc(
        `idempotencyKeys/${actor.organizationId}_submitSupplierInvoice_${input.idempotencyKey}`,
      );
    const uniqueness = db.doc(
      `supplierInvoiceCodes/${uniquenessDocumentId(actor.organizationId, String(order.get("supplierId")), normalizeInventoryIdentifier(input.supplierInvoiceNumber))}`,
    );
    let result = { supplierInvoiceId: invoice.id, submitted: true };
    await db.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(
        operation,
        uniqueness,
        ...itemRefs,
        ...counterRefs,
      );
      const previous = snapshots[0]!,
        unique = snapshots[1]!;
      if (previous.exists) {
        result = {
          supplierInvoiceId: String(previous.get("entityId")),
          submitted: false,
        };
        return;
      }
      if (unique.exists)
        throw new HttpsError(
          "already-exists",
          "This supplier invoice number has already been recorded.",
        );
      const items = snapshots.slice(2, 2 + itemRefs.length),
        counters = snapshots.slice(2 + itemRefs.length);
      const calculated = input.lines.map((line, index) => {
        const itemSnapshot = items[index]!;
        if (
          !itemSnapshot.exists ||
          itemSnapshot.get("purchaseOrderId") !== purchaseOrder.id
        )
          throw new HttpsError(
            "invalid-argument",
            "An invoice line does not belong to this purchase order.",
          );
        const available =
          Number(itemSnapshot.get("receivedQuantity") ?? 0) -
          Number(counters[index]!.get("invoicedQuantity") ?? 0);
        if (line.quantity > available)
          throw new HttpsError(
            "failed-precondition",
            "Invoice quantity exceeds received uninvoiced goods.",
          );
        const net = line.quantity * Number(itemSnapshot.get("unitCostMinor")),
          vat = Math.round(
            (net * Number(itemSnapshot.get("vatRateBasisPoints"))) / 10_000,
          );
        return { line, itemSnapshot, net, vat, gross: net + vat };
      });
      const net = calculated.reduce((sum, line) => sum + line.net, 0),
        vat = calculated.reduce((sum, line) => sum + line.vat, 0),
        now = FieldValue.serverTimestamp();
      transaction.create(
        invoice,
        clean({
          organizationId: actor.organizationId,
          supplierId: order.get("supplierId"),
          supplierNumber: order.get("supplierNumber"),
          supplierName: order.get("supplierName"),
          purchaseOrderId: purchaseOrder.id,
          purchaseOrderNumber: order.get("purchaseOrderNumber"),
          branchId: order.get("branchId"),
          warehouseId: order.get("warehouseId"),
          operationalLocationType: order.get("operationalLocationType"),
          operationalLocationId: order.get("operationalLocationId"),
          supplierInvoiceNumber: input.supplierInvoiceNumber,
          invoiceDate: input.invoiceDate,
          dueDate: input.dueDate,
          status: "submitted",
          netAmountMinor: net,
          vatAmountMinor: vat,
          grossAmountMinor: net + vat,
          outstandingAmountMinor: net + vat,
          currency: "NGN",
          notes: input.notes,
          createdAt: now,
          createdBy: actor.userId,
          submittedAt: now,
        }),
      );
      for (const line of calculated)
        transaction.create(db.collection("supplierInvoiceItems").doc(), clean({
          organizationId: actor.organizationId,
          supplierInvoiceId: invoice.id,
          purchaseOrderId: purchaseOrder.id,
          purchaseOrderItemId: line.itemSnapshot.id,
          branchId: order.get("branchId"),
          warehouseId: order.get("warehouseId"),
          operationalLocationType: order.get("operationalLocationType"),
          operationalLocationId: order.get("operationalLocationId"),
          productId: line.itemSnapshot.get("productId"),
          sku: line.itemSnapshot.get("sku"),
          productName: line.itemSnapshot.get("productName"),
          quantity: line.line.quantity,
          unitCostMinor: line.itemSnapshot.get("unitCostMinor"),
          vatRateBasisPoints: line.itemSnapshot.get("vatRateBasisPoints"),
          netAmountMinor: line.net,
          vatAmountMinor: line.vat,
          grossAmountMinor: line.gross,
          currency: "NGN",
          createdAt: now,
        }));
      transaction.create(uniqueness, {
        organizationId: actor.organizationId,
        supplierId: order.get("supplierId"),
        supplierInvoiceId: invoice.id,
        normalizedInvoiceNumber: normalizeInventoryIdentifier(
          input.supplierInvoiceNumber,
        ),
        createdAt: now,
      });
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "submitSupplierInvoice",
        entityId: invoice.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: "supplier_invoice.submitted",
        entityType: "supplierInvoice",
        entityId: invoice.id,
        correlationId: correlationId(),
        sourceFunction: "submitSupplierInvoice",
        after: {
          purchaseOrderId: purchaseOrder.id,
          supplierInvoiceNumber: input.supplierInvoiceNumber,
          grossAmountMinor: net + vat,
        },
      });
    });
    return result;
  },
);

export const approveSupplierInvoice = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "payables.approve");
    const input = parseInput(supplierInvoiceActionInput, request.data);
    const invoice = db.doc(`supplierInvoices/${input.supplierInvoiceId}`),
      initial = await invoice.get();
    if (
      !initial.exists ||
      initial.get("organizationId") !== actor.organizationId
    )
      throw new HttpsError("not-found", "Supplier invoice not found.");
    requireProcurementScope(actor, procurementScopeFrom(initial));
    const invoiceItems = await db
      .collection("supplierInvoiceItems")
      .where("supplierInvoiceId", "==", invoice.id)
      .get();
    const counterRefs = invoiceItems.docs.map((line) =>
      db.doc(
        `purchaseInvoiceItemCounters/${invoiceCounterId(actor.organizationId, String(line.get("purchaseOrderItemId")))}`,
      ),
    );
    const itemRefs = invoiceItems.docs.map((line) =>
      db.doc(`purchaseOrderItems/${line.get("purchaseOrderItemId")}`),
    );
    const supplier = db.doc(`suppliers/${initial.get("supplierId")}`),
      purchaseOrder = db.doc(
        `purchaseOrders/${initial.get("purchaseOrderId")}`,
      ),
      operation = db.doc(
        `idempotencyKeys/${actor.organizationId}_approveSupplierInvoice_${input.idempotencyKey}`,
      ),
      journalCounter = db.doc(
        `journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`,
      ),
      journal = db.collection("journalEntries").doc();
    const effectiveAt = Timestamp.fromDate(
      new Date(String(initial.get("invoiceDate"))),
    );
    const accountingPeriod = accountingPeriodReference(
      actor.organizationId,
      effectiveAt,
    );
    await db.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(
        operation,
        invoice,
        supplier,
        purchaseOrder,
        journalCounter,
        accountingPeriod,
        ...itemRefs,
        ...counterRefs,
      );
      let cursor = 0;
      const previous = snapshots[cursor++]!,
        current = snapshots[cursor++]!,
        supplierSnapshot = snapshots[cursor++]!,
        order = snapshots[cursor++]!,
        journalCounterSnapshot = snapshots[cursor++]!;
      const accountingPeriodSnapshot = snapshots[cursor++]!;
      if (previous.exists) return;
      if (!current.exists || current.get("status") !== "submitted")
        throw new HttpsError(
          "failed-precondition",
          "Only a submitted supplier invoice can be approved.",
        );
      assertAccountingPeriodOpen(accountingPeriodSnapshot);
      if (current.get("createdBy") === actor.userId && !canSelfAuthorize(actor))
        throw new HttpsError(
          "permission-denied",
          "This role cannot approve its own supplier invoice.",
          { code: "SUPPLIER_INVOICE_SELF_APPROVAL_FORBIDDEN" },
        );
      if (
        !supplierSnapshot.exists ||
        supplierSnapshot.get("organizationId") !== actor.organizationId
      )
        throw new HttpsError("failed-precondition", "Supplier is unavailable.");
      const items = snapshots.slice(cursor, (cursor += itemRefs.length)),
        counters = snapshots.slice(cursor);
      invoiceItems.docs.forEach((line, index) => {
        const orderedItem = items[index]!,
          counter = counters[index]!,
          quantity = Number(line.get("quantity"));
        if (
          !orderedItem.exists ||
          orderedItem.get("purchaseOrderId") !== order.id ||
          quantity >
            Number(orderedItem.get("receivedQuantity") ?? 0) -
              Number(counter.get("invoicedQuantity") ?? 0)
        )
          throw new HttpsError(
            "failed-precondition",
            "An invoice quantity is no longer available for approval.",
          );
      });
      const now = FieldValue.serverTimestamp(),
        gross = Number(current.get("grossAmountMinor"));
      const lines = journalLines(
        Number(current.get("netAmountMinor")),
        Number(current.get("vatAmountMinor")),
        "2000",
      );
      writeJournal(transaction, actor, {
        journal,
        journalCounter,
        journalCounterValue:
          Number(journalCounterSnapshot.get("value") ?? 0) + 1,
        journalType: "supplier_invoice",
        referenceType: "supplierInvoice",
        referenceId: invoice.id,
        referenceNumber: String(current.get("supplierInvoiceNumber")),
        description: `Supplier invoice ${String(current.get("supplierInvoiceNumber"))}`,
        branchId: current.get("branchId") || undefined,
        warehouseId: current.get("warehouseId") || undefined,
        effectiveAt,
        lines,
      });
      transaction.update(invoice, {
        status: "approved",
        approvedAt: now,
        approvedBy: actor.userId,
        approvalNotes: input.notes ?? null,
        journalEntryId: journal.id,
        updatedAt: now,
      });
      invoiceItems.docs.forEach((line, index) => {
        const nextInvoiced =
          Number(counters[index]!.get("invoicedQuantity") ?? 0) +
          Number(line.get("quantity"));
        transaction.set(
          counterRefs[index]!,
          {
            organizationId: actor.organizationId,
            purchaseOrderId: order.id,
            purchaseOrderItemId: line.get("purchaseOrderItemId"),
            invoicedQuantity: nextInvoiced,
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.update(itemRefs[index]!, {
          invoicedQuantity: nextInvoiced,
          updatedAt: now,
        });
      });
      transaction.update(supplier, {
        outstandingBalanceMinor:
          Number(supplierSnapshot.get("outstandingBalanceMinor") ?? 0) + gross,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.update(purchaseOrder, {
        invoicedNetAmountMinor:
          Number(order.get("invoicedNetAmountMinor") ?? 0) +
          Number(current.get("netAmountMinor")),
        updatedAt: now,
      });
      transaction.create(db.collection("supplierAccountEntries").doc(), clean({
        organizationId: actor.organizationId,
        supplierId: supplier.id,
        branchId: current.get("branchId"),
        warehouseId: current.get("warehouseId"),
        operationalLocationType: current.get("operationalLocationType"),
        operationalLocationId: current.get("operationalLocationId"),
        entryType: "supplier_invoice",
        referenceType: "supplierInvoice",
        referenceId: invoice.id,
        referenceNumber: current.get("supplierInvoiceNumber"),
        amountMinor: gross,
        balanceAfterMinor:
          Number(supplierSnapshot.get("outstandingBalanceMinor") ?? 0) + gross,
        currency: "NGN",
        effectiveAt,
        createdAt: now,
        createdBy: actor.userId,
      }));
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "approveSupplierInvoice",
        entityId: invoice.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: "supplier_invoice.approved",
        entityType: "supplierInvoice",
        entityId: invoice.id,
        correlationId: correlationId(),
        sourceFunction: "approveSupplierInvoice",
        after: { grossAmountMinor: gross, journalEntryId: journal.id },
      });
    });
    return { supplierInvoiceId: invoice.id, approved: true };
  },
);

export const recordSupplierPayment = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "payables.pay");
    const input = parseInput(recordSupplierPaymentInput, request.data);
    if (input.branchId) requireBranchScope(actor, input.branchId);
    if (input.warehouseId) requireWarehouseScope(actor, input.warehouseId);
    const supplier = db.doc(`suppliers/${input.supplierId}`),
      invoiceRefs = input.allocations.map((allocation) =>
        db.doc(`supplierInvoices/${allocation.supplierInvoiceId}`),
      );
    const paymentLocation = input.branchId ? db.doc(`branches/${input.branchId}`)
      : input.warehouseId ? db.doc(`warehouses/${input.warehouseId}`) : supplier;
    const bankAccount = input.bankAccountId
      ? db.doc(`bankAccounts/${input.bankAccountId}`)
      : db.doc("bankAccounts/no-bank-account");
    const operation = db.doc(
        `idempotencyKeys/${actor.organizationId}_recordSupplierPayment_${input.idempotencyKey}`,
      ),
      payment = db.collection("supplierPayments").doc(),
      journalCounter = db.doc(
        `journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`,
      ),
      journal = db.collection("journalEntries").doc();
    const effectiveAt = Timestamp.fromDate(new Date(input.paidAt));
    const accountingPeriod = accountingPeriodReference(
      actor.organizationId,
      effectiveAt,
    );
    let result = { paymentId: payment.id, recorded: true };
    await db.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(
        operation,
        supplier,
        journalCounter,
        accountingPeriod,
        bankAccount,
        paymentLocation,
        ...invoiceRefs,
      );
      const previous = snapshots[0]!,
        supplierSnapshot = snapshots[1]!,
        journalCounterSnapshot = snapshots[2]!,
        accountingPeriodSnapshot = snapshots[3]!,
        bankAccountSnapshot = snapshots[4]!, locationSnapshot = snapshots[5]!;
      if (previous.exists) {
        result = {
          paymentId: String(previous.get("entityId")),
          recorded: false,
        };
        return;
      }
      assertAccountingPeriodOpen(accountingPeriodSnapshot);
      if (
        !supplierSnapshot.exists ||
        supplierSnapshot.get("organizationId") !== actor.organizationId
      )
        throw new HttpsError("failed-precondition", "Supplier is unavailable.");
      if ((input.branchId || input.warehouseId) && (!locationSnapshot.exists || locationSnapshot.get("organizationId") !== actor.organizationId || locationSnapshot.get("status") !== "active"))
        throw new HttpsError("failed-precondition", "Choose an active payment store.");
      if (input.purpose === "advance" && supplierSnapshot.get("active") !== true)
        throw new HttpsError("failed-precondition", "New advances require an active supplier.");
      const invoices = snapshots.slice(6),
        total = input.purpose === "advance" ? input.amountMinor! : input.allocations.reduce(
          (sum, allocation) => sum + allocation.amountMinor,
          0,
        );
      input.allocations.forEach((allocation, index) => {
        const invoice = invoices[index]!;
        requireProcurementScope(actor, procurementScopeFrom(invoice));
        if (
          !invoice.exists ||
          invoice.get("organizationId") !== actor.organizationId ||
          invoice.get("supplierId") !== supplier.id ||
          !["approved", "partially_paid"].includes(
            String(invoice.get("status")),
          ) ||
          allocation.amountMinor >
            Number(invoice.get("outstandingAmountMinor") ?? 0)
        )
          throw new HttpsError(
            "failed-precondition",
            "A payment allocation exceeds an approved outstanding supplier invoice.",
          );
      });
      const currentBalance = supplierMoney(supplierSnapshot.get("outstandingBalanceMinor"));
      const currentAdvance = supplierMoney(supplierSnapshot.get("advanceBalanceMinor"));
      if (input.purpose === "payment" && total > currentBalance)
        throw new HttpsError(
          "failed-precondition",
          "Payment exceeds the supplier's outstanding balance.",
        );
      if (input.source === "advance_balance" && total > currentAdvance)
        throw new HttpsError("failed-precondition", "The supplier has insufficient unused advance credit.");
      const paymentScope = input.branchId || input.warehouseId ? { branchId: input.branchId, warehouseId: input.warehouseId } : procurementScopeFrom(invoices[0]!);
      if (invoices.some((invoice) => (invoice.get("branchId") || undefined) !== paymentScope.branchId || (invoice.get("warehouseId") || undefined) !== paymentScope.warehouseId))
        throw new HttpsError("invalid-argument", "Settle invoices in their own recording store. Payments covering different stores must be recorded separately.");
      const advanceDelta = input.purpose === "advance" ? total : input.source === "advance_balance" ? -total : 0;
      const nextAdvance = supplierMoney(currentAdvance + advanceDelta);
      const nextBalance = supplierMoney(currentBalance - (input.purpose === "advance" ? 0 : total));
      const scopeKey = paymentScope.branchId ? `branch:${paymentScope.branchId}` : `warehouse:${paymentScope.warehouseId}`;
      const advanceBalances = { ...(supplierSnapshot.get("advanceBalancesByLocation") ?? {}) } as Record<string, number>;
      const scopedAdvance = supplierMoney(advanceBalances[scopeKey]);
      if (input.source === "advance_balance" && total > scopedAdvance)
        throw new HttpsError("failed-precondition", "This store has insufficient unused supplier advance. Credit from another store needs an authorized transfer first.");
      if (advanceDelta) {
        if (Object.values(advanceBalances).reduce((sum, amount) => sum + supplierMoney(amount), 0) !== currentAdvance)
          throw new HttpsError("failed-precondition", "Supplier advance locations require reconciliation before posting.");
        advanceBalances[scopeKey] = supplierMoney(scopedAdvance + advanceDelta);
      }
      const now = FieldValue.serverTimestamp(),
        paymentNumber = `PAY-${payment.id.slice(0, 10).toUpperCase()}`;
      const settlement: ReturnType<typeof resolveSettlementAccount> = input.source === "advance_balance" ? { accountCode: "1250", accountName: accountNames["1250"]! } : resolveSettlementAccount(
        actor.organizationId,
        input.method,
        input.bankAccountId,
        bankAccountSnapshot,
      );
      const lines = [
        { accountCode: input.purpose === "advance" ? "1250" : "2000", debitMinor: total, creditMinor: 0 },
        {
          accountCode: settlement.accountCode,
          accountName: settlement.accountName,
          debitMinor: 0,
          creditMinor: total,
        },
      ];
      assertBalancedJournal(lines);
      writeJournal(transaction, actor, {
        journal,
        journalCounter,
        journalCounterValue:
          Number(journalCounterSnapshot.get("value") ?? 0) + 1,
        journalType: input.purpose === "advance" ? "supplier_advance" : input.source === "advance_balance" ? "supplier_advance_applied" : "supplier_payment",
        referenceType: "supplierPayment",
        referenceId: payment.id,
        referenceNumber: paymentNumber,
        description: `Supplier payment ${paymentNumber}`,
        ...paymentScope,
        effectiveAt,
        lines,
      });
      input.allocations.forEach((allocation, index) => {
        const invoice = invoices[index]!,
          next =
            Number(invoice.get("outstandingAmountMinor")) -
            allocation.amountMinor;
        transaction.update(invoiceRefs[index]!, {
          outstandingAmountMinor: next,
          status: next === 0 ? "paid" : "partially_paid",
          updatedAt: now,
          lastPaymentId: payment.id,
        });
        transaction.create(db.collection("supplierPaymentAllocations").doc(), {
          organizationId: actor.organizationId,
          supplierId: supplier.id,
          supplierPaymentId: payment.id,
          supplierInvoiceId: invoice.id,
          amountMinor: allocation.amountMinor,
          currency: "NGN",
          createdAt: now,
        });
      });
      transaction.update(supplier, {
        outstandingBalanceMinor: nextBalance,
        advanceBalanceMinor: nextAdvance,
        advanceBalancesByLocation: advanceBalances,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.create(
        payment,
        clean({
          organizationId: actor.organizationId,
          supplierId: supplier.id,
          supplierNumber: supplierSnapshot.get("supplierNumber"),
          supplierName: supplierSnapshot.get("name"),
          ...paymentScope,
          paymentNumber,
          purpose: input.purpose,
          source: input.source,
          method: input.source === "advance_balance" ? "supplier_advance" : input.method,
          reference: input.reference,
          bankAccountId: settlement.bankAccountId,
          bankName: settlement.bankName,
          bankAccountName: settlement.bankAccountName,
          accountNumberLast4: settlement.accountNumberLast4,
          ledgerAccountCode: settlement.accountCode,
          amountMinor: total,
          currency: "NGN",
          status: "recorded",
          paidAt: effectiveAt,
          recordedAt: now,
          recordedBy: actor.userId,
          notes: input.notes,
          journalEntryId: journal.id,
          createdAt: now,
        }),
      );
      transaction.create(db.collection("supplierAccountEntries").doc(), clean({
        organizationId: actor.organizationId,
        supplierId: supplier.id,
        ...paymentScope,
        entryType: input.purpose === "advance" ? "supplier_advance" : input.source === "advance_balance" ? "supplier_advance_applied" : "supplier_payment",
        referenceType: "supplierPayment",
        referenceId: payment.id,
        referenceNumber: paymentNumber,
        amountMinor: input.purpose === "advance" ? 0 : -total,
        advanceAmountMinor: advanceDelta,
        advanceBalanceAfterMinor: nextAdvance,
        journalEntryId: journal.id,
        allocations: input.allocations,
        balanceAfterMinor: nextBalance,
        currency: "NGN",
        effectiveAt,
        createdAt: now,
        createdBy: actor.userId,
      }));
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "recordSupplierPayment",
        entityId: payment.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: input.purpose === "advance" ? "supplier.advance_recorded" : input.source === "advance_balance" ? "supplier.advance_applied" : "supplier_payment.recorded",
        entityType: "supplierPayment",
        entityId: payment.id,
        correlationId: correlationId(),
        sourceFunction: "recordSupplierPayment",
        after: {
          supplierId: supplier.id,
          amountMinor: total,
          method: input.method,
          purpose: input.purpose,
          source: input.source,
          advanceBalanceAfterMinor: nextAdvance,
          bankAccountId: settlement.bankAccountId ?? null,
          ledgerAccountCode: settlement.accountCode,
        },
      });
    });
    return result;
  },
);
