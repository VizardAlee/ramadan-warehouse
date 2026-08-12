import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const projectId = process.env.GCLOUD_PROJECT ?? "";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  !projectId.startsWith("demo-")
) {
  throw new Error(
    "Refusing to seed: both Auth and Firestore emulators and a demo-* project ID are required.",
  );
}
if (getApps().length === 0) initializeApp({ projectId });
const auth = getAuth();
const db = getFirestore();
const organizationId = "development-organization";
const adminEmail = "admin@warehouse.local";
const normalize = (value) => value.trim().replace(/\s+/g, " ").toUpperCase();
const uniqueId = (...values) =>
  values.map((value) => encodeURIComponent(normalize(value))).join("__");
const balanceId = (productId, locationId, lotId) =>
  [organizationId, productId, locationId, lotId ?? "base"]
    .map(encodeURIComponent)
    .join("__");

let administrator;
try {
  administrator = await auth.getUserByEmail(adminEmail);
} catch (error) {
  if (error?.code !== "auth/user-not-found") throw error;
  administrator = await auth.createUser({
    email: adminEmail,
    password: "EmulatorOnly!234567",
    displayName: "Development Administrator",
    emailVerified: true,
  });
}
await auth.setCustomUserClaims(administrator.uid, {
  organizationId,
  platformRole: "system_administrator",
  authorizationVersion: 1,
});

const requesterEmail = "requester.kaduna@warehouse.local";
let requester;
try {
  requester = await auth.getUserByEmail(requesterEmail);
} catch (error) {
  if (error?.code !== "auth/user-not-found") throw error;
  requester = await auth.createUser({
    email: requesterEmail,
    password: "EmulatorOnly!234567",
    displayName: "Kaduna Branch Requester",
    emailVerified: true,
  });
}
await auth.setCustomUserClaims(requester.uid, {
  organizationId,
  authorizationVersion: 1,
});

const now = FieldValue.serverTimestamp();
const effectiveAt = Timestamp.fromDate(new Date("2026-01-01T09:00:00.000Z"));
const batch = db.batch();
batch.set(
  db.doc(`organizations/${organizationId}`),
  {
    legalName: "Development Solar Organization",
    tradingName: "Development Solar",
    code: "DEV",
    phoneNumbers: [],
    defaultCurrency: "NGN",
    timezone: "Africa/Lagos",
    status: "active",
    openingStockEnabled: true,
    createdAt: now,
    createdBy: administrator.uid,
    updatedAt: now,
    updatedBy: administrator.uid,
  },
  { merge: true },
);
batch.set(
  db.doc(`users/${administrator.uid}`),
  {
    uid: administrator.uid,
    organizationId,
    email: adminEmail,
    displayName: "Development Administrator",
    roleId: "system_administrator",
    branchIds: ["kaduna"],
    warehouseIds: ["central"],
    status: "active",
    authDisabled: false,
    authorizationVersion: 1,
    createdAt: now,
    createdBy: administrator.uid,
    updatedAt: now,
    updatedBy: administrator.uid,
  },
  { merge: true },
);
batch.set(
  db.doc("branches/kaduna"),
  {
    organizationId,
    name: "Kaduna Branch",
    code: "KD",
    state: "Kaduna",
    status: "active",
    createdAt: now,
    createdBy: administrator.uid,
    updatedAt: now,
    updatedBy: administrator.uid,
  },
  { merge: true },
);
batch.set(
  db.doc("branches/kano"),
  {
    organizationId,
    name: "Kano Branch",
    code: "KN",
    state: "Kano",
    status: "active",
    createdAt: now,
    createdBy: administrator.uid,
    updatedAt: now,
    updatedBy: administrator.uid,
  },
  { merge: true },
);
batch.set(
  db.doc(`users/${requester.uid}`),
  {
    uid: requester.uid,
    organizationId,
    email: requesterEmail,
    displayName: "Kaduna Branch Requester",
    roleId: "branch_requester",
    branchIds: ["kaduna"],
    warehouseIds: [],
    status: "active",
    authDisabled: false,
    authorizationVersion: 1,
    createdAt: now,
    createdBy: administrator.uid,
    updatedAt: now,
    updatedBy: administrator.uid,
  },
  { merge: true },
);
batch.set(
  db.doc("warehouses/central"),
  {
    organizationId,
    name: "Central Warehouse",
    code: "WH",
    state: "Kaduna",
    managerIds: [administrator.uid],
    status: "active",
    createdAt: now,
    createdBy: administrator.uid,
    updatedAt: now,
    updatedBy: administrator.uid,
  },
  { merge: true },
);

const locations = [
  [
    "central-main",
    "Central Warehouse Main Storage",
    "WH-MAIN",
    "warehouse",
    "central",
    null,
    false,
  ],
  [
    "central-secondary",
    "Central Warehouse Secondary Storage",
    "WH-SEC",
    "warehouse",
    "central",
    null,
    false,
  ],
  ["damaged", "Damaged Stock", "DMG", "damaged", "central", null, true],
  [
    "quarantine",
    "Quarantined Stock",
    "QRT",
    "quarantined",
    "central",
    null,
    true,
  ],
  ["returns", "Returned Stock", "RTN", "returned", "central", null, true],
  [
    "kaduna-stock",
    "Kaduna Branch Stock",
    "KD-STOCK",
    "branch",
    null,
    "kaduna",
    false,
  ],
  [
    "kano-stock",
    "Kano Branch Stock",
    "KN-STOCK",
    "branch",
    null,
    "kano",
    false,
  ],
  [
    "transit-kano",
    "Goods in Transit to Kano",
    "GIT-KN",
    "goods_in_transit",
    null,
    "kano",
    true,
  ],
  [
    "transit-kaduna",
    "Goods in Transit to Kaduna",
    "GIT-KD",
    "goods_in_transit",
    null,
    "kaduna",
    true,
  ],
  [
    "damaged-kaduna",
    "Kaduna Damaged Stock",
    "DMG-KD",
    "damaged",
    null,
    "kaduna",
    true,
  ],
];
for (const [
  id,
  name,
  code,
  type,
  warehouseId,
  branchId,
  systemManaged,
] of locations) {
  batch.set(
    db.doc(`inventoryLocations/${id}`),
    {
      organizationId,
      name,
      code,
      type,
      ...(warehouseId ? { warehouseId } : {}),
      ...(branchId ? { branchId } : {}),
      status: "active",
      systemManaged,
      createdAt: now,
      createdBy: administrator.uid,
      updatedAt: now,
      updatedBy: administrator.uid,
    },
    { merge: true },
  );
}

const categories = [
  ["power-electronics", "Power Electronics", "POWER"],
  ["energy-storage", "Energy Storage", "STORAGE"],
  ["solar-generation", "Solar Generation", "SOLAR"],
  ["electrical-accessories", "Electrical Accessories", "ELECTRICAL"],
  ["mounting", "Mounting", "MOUNTING"],
];
for (const [id, name, code] of categories) {
  batch.set(
    db.doc(`productCategories/${id}`),
    {
      organizationId,
      name,
      code,
      active: true,
      createdAt: now,
      createdBy: administrator.uid,
      updatedAt: now,
      updatedBy: administrator.uid,
    },
    { merge: true },
  );
  batch.set(
    db.doc(
      `organizationCodes/${uniqueId(organizationId, "productCategory", code)}`,
    ),
    {
      organizationId,
      kind: "productCategory",
      code,
      entityId: id,
      updatedAt: now,
    },
    { merge: true },
  );
}

const products = [
  [
    "hybrid-inverter-62",
    "6.2kVA Hybrid Inverter",
    "INV-6.2K",
    "serial",
    "power-electronics",
    2,
    650_000_00,
  ],
  [
    "lithium-battery-10",
    "10kWh Lithium Battery",
    "BAT-10KWH",
    "serial",
    "energy-storage",
    2,
    1_250_000_00,
  ],
  [
    "solar-panel-580",
    "580W Monocrystalline Solar Panel",
    "PV-580W",
    "quantity",
    "solar-generation",
    40,
    145_000_00,
  ],
  [
    "dc-cable-6mm",
    "6mm² DC Solar Cable",
    "DC-CABLE-6",
    "batch",
    "electrical-accessories",
    500,
    850_00,
  ],
  [
    "dc-breaker-63a",
    "63A DC Breaker",
    "DCB-63A",
    "quantity",
    "electrical-accessories",
    20,
    18_500_00,
  ],
  [
    "mounting-rail",
    "Mounting Rail",
    "RAIL-4200",
    "quantity",
    "mounting",
    30,
    32_000_00,
  ],
];
products.forEach(
  (
    [id, name, sku, trackingType, categoryId, quantity, unitCostMinor],
    index,
  ) => {
    const transactionId = `seed-opening-${id}`;
    const transactionNumber = `INV-2026-${String(index + 1).padStart(6, "0")}`;
    const lotId =
      trackingType === "batch"
        ? uniqueId(organizationId, id, "SEED-LOT-001")
        : undefined;
    const movedQuantity =
      id === "dc-breaker-63a" ||
      id === "hybrid-inverter-62" ||
      id === "lithium-battery-10"
        ? id === "dc-breaker-63a"
          ? 4
          : 1
        : 0;
    const sourceQuantity = quantity - movedQuantity;
    const value = quantity * unitCostMinor;
    const sourceValue = sourceQuantity * unitCostMinor;
    batch.set(
      db.doc(`products/${id}`),
      {
        organizationId,
        name,
        sku,
        normalizedSku: normalize(sku),
        categoryId,
        categoryName: categories.find(
          ([category]) => category === categoryId,
        )?.[1],
        unitOfMeasure: id === "dc-cable-6mm" ? "metre" : "unit",
        trackingType,
        currency: "NGN",
        active: true,
        hasLedgerActivity: true,
        createdAt: now,
        createdBy: administrator.uid,
        updatedAt: now,
        updatedBy: administrator.uid,
      },
      { merge: true },
    );
    batch.set(
      db.doc(`productCosts/${id}`),
      {
        organizationId,
        productId: id,
        defaultUnitCostMinor: unitCostMinor,
        currency: "NGN",
        updatedAt: now,
        updatedBy: administrator.uid,
      },
      { merge: true },
    );
    batch.set(
      db.doc(`organizationSkus/${uniqueId(organizationId, sku)}`),
      {
        organizationId,
        normalizedSku: normalize(sku),
        productId: id,
        updatedAt: now,
      },
      { merge: true },
    );
    batch.set(
      db.doc(`inventoryTransactions/${transactionId}`),
      {
        organizationId,
        transactionNumber,
        transactionType: "opening_balance",
        status: "posted",
        destinationLocationId: "central-main",
        destinationWarehouseId: "central",
        effectiveAt,
        postedAt: now,
        postedBy: administrator.uid,
        reason: "Idempotent emulator demonstration seed",
        idempotencyKey: transactionId,
        correlationId: transactionId,
        createdAt: now,
        createdBy: administrator.uid,
      },
      { merge: true },
    );
    const entryBase = {
      organizationId,
      transactionId,
      transactionNumber,
      transactionType: "opening_balance",
      productId: id,
      sku,
      unitCostMinor,
      currency: "NGN",
      ...(lotId ? { lotId } : {}),
      effectiveAt,
      postedBy: administrator.uid,
      reason: "Idempotent emulator demonstration seed",
      createdAt: now,
    };
    batch.set(db.doc(`inventoryEntries/${transactionId}-external`), {
      ...entryBase,
      externalAccount: "migration",
      counterpartyLocationId: "central-main",
      quantityDelta: -quantity,
      valueDeltaMinor: -value,
      balanceBefore: 0,
      balanceAfter: 0,
    });
    batch.set(db.doc(`inventoryEntries/${transactionId}-location`), {
      ...entryBase,
      locationId: "central-main",
      warehouseId: "central",
      externalAccount: "migration",
      quantityDelta: quantity,
      valueDeltaMinor: value,
      balanceBefore: 0,
      balanceAfter: quantity,
    });
    batch.set(
      db.doc(`inventoryBalances/${balanceId(id, "central-main", lotId)}`),
      {
        organizationId,
        productId: id,
        sku,
        trackingType,
        locationId: "central-main",
        warehouseId: "central",
        ...(lotId ? { lotId } : {}),
        onHandQuantity: sourceQuantity,
        reservedQuantity: 0,
        availableQuantity: sourceQuantity,
        averageUnitCostMinor: unitCostMinor,
        totalValueMinor: sourceValue,
        currency: "NGN",
        lastTransactionId:
          id === "dc-breaker-63a"
            ? "seed-transfer-dispatch"
            : id === "hybrid-inverter-62"
              ? "seed-disputed-damage"
              : id === "lithium-battery-10"
                ? "seed-disputed-missing"
                : transactionId,
        lastMovementAt: effectiveAt,
        version: movedQuantity ? 2 : 1,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    if (lotId) {
      batch.set(
        db.doc(`inventoryLots/${lotId}`),
        {
          organizationId,
          productId: id,
          sku,
          lotNumber: "SEED-LOT-001",
          normalizedLotNumber: "SEED-LOT-001",
          quantityReceived: quantity,
          remainingQuantity: quantity,
          locationQuantities: { "central-main": quantity },
          unitCostMinor,
          receiptDate: "2026-01-01",
          status: "active",
          lastTransactionId: transactionId,
          createdAt: now,
          createdBy: administrator.uid,
          updatedAt: now,
          updatedBy: administrator.uid,
        },
        { merge: true },
      );
    }
    if (trackingType === "serial") {
      for (let serialIndex = 1; serialIndex <= quantity; serialIndex += 1) {
        const serialNumber = `${sku}-SN-${String(serialIndex).padStart(3, "0")}`;
        const movedSerial =
          serialIndex === 1 &&
          (id === "hybrid-inverter-62" || id === "lithium-battery-10");
        const serialLocation = movedSerial
          ? id === "hybrid-inverter-62"
            ? "damaged-kaduna"
            : "transit-kaduna"
          : "central-main";
        const serialTransaction = movedSerial
          ? id === "hybrid-inverter-62"
            ? "seed-disputed-damage"
            : "seed-disputed-missing"
          : transactionId;
        batch.set(
          db.doc(`serializedItems/${uniqueId(organizationId, serialNumber)}`),
          {
            organizationId,
            productId: id,
            sku,
            serialNumber,
            normalizedSerialNumber: normalize(serialNumber),
            currentLocationId: serialLocation,
            ...(movedSerial
              ? { branchId: "kaduna" }
              : { warehouseId: "central" }),
            status: movedSerial
              ? id === "hybrid-inverter-62"
                ? "damaged"
                : "in_transit"
              : "available",
            acquisitionUnitCostMinor: unitCostMinor,
            currentUnitCostMinor: unitCostMinor,
            currency: "NGN",
            lastTransactionId: serialTransaction,
            lastMovementAt: effectiveAt,
            active: true,
            createdAt: now,
            createdBy: administrator.uid,
            updatedAt: now,
            updatedBy: administrator.uid,
          },
          { merge: true },
        );
      }
    }
  },
);

batch.set(
  db.doc(`inventoryCounters/${organizationId}_transactions`),
  {
    organizationId,
    kind: "inventoryTransaction",
    value: products.length + 3,
    updatedAt: now,
  },
  { merge: true },
);

const requestTime = Timestamp.fromDate(new Date("2026-02-01T09:00:00.000Z"));
const productById = new Map(
  products.map(([id, name, sku, trackingType, categoryId]) => [
    id,
    { name, sku, trackingType, categoryId },
  ]),
);
const seededRequests = [
  {
    id: "seed-request-draft",
    requestNumber: "REQ-KD-2026-000001",
    branchId: "kaduna",
    branchName: "Kaduna Branch",
    requestType: "stock_replenishment",
    priority: "normal",
    purpose: "Routine replenishment for Kaduna installations",
    status: "draft",
    version: 0,
    items: [
      ["solar-panel-580", 20, 0],
      ["hybrid-inverter-62", 2, 0],
    ],
  },
  {
    id: "seed-request-urgent",
    requestNumber: "REQ-KN-2026-000002",
    branchId: "kano",
    branchName: "Kano Branch",
    requestType: "emergency_replacement",
    priority: "urgent",
    purpose: "Urgent replacement inventory for active customer sites",
    status: "submitted",
    version: 1,
    items: [
      ["lithium-battery-10", 4, 0],
      ["hybrid-inverter-62", 4, 0],
    ],
  },
  {
    id: "seed-request-partial",
    requestNumber: "REQ-KD-2026-000003",
    branchId: "kaduna",
    branchName: "Kaduna Branch",
    requestType: "project_allocation",
    priority: "high",
    purpose: "Materials required for the community solar project",
    status: "partially_approved",
    version: 1,
    items: [
      ["solar-panel-580", 50, 30],
      ["dc-breaker-63a", 10, 10],
      ["hybrid-inverter-62", 5, 2],
    ],
  },
  {
    id: "seed-request-changes",
    requestNumber: "REQ-KD-2026-000004",
    branchId: "kaduna",
    branchName: "Kaduna Branch",
    requestType: "warranty_replacement",
    priority: "high",
    purpose: "Warranty replacement awaiting a valid warranty reference",
    status: "changes_requested",
    version: 1,
    items: [["lithium-battery-10", 1, 0]],
  },
];
for (const seeded of seededRequests) {
  const totalRequested = seeded.items.reduce(
    (sum, [, quantity]) => sum + quantity,
    0,
  );
  const totalApproved = seeded.items.reduce(
    (sum, [, , approved]) => sum + approved,
    0,
  );
  const totalRejected =
    seeded.status === "partially_approved" ? totalRequested - totalApproved : 0;
  batch.set(
    db.doc(`branchRequests/${seeded.id}`),
    {
      organizationId,
      requestNumber: seeded.requestNumber,
      branchId: seeded.branchId,
      branchName: seeded.branchName,
      requestType: seeded.requestType,
      priority: seeded.priority,
      purpose: seeded.purpose,
      status: seeded.status,
      totalRequestedQuantity: totalRequested,
      totalApprovedQuantity: totalApproved,
      totalRejectedQuantity: totalRejected,
      totalFulfilledQuantity: 0,
      totalOutstandingQuantity: totalApproved,
      totalCancelledOutstandingQuantity: 0,
      itemCount: seeded.items.length,
      version: seeded.version,
      ...(seeded.version
        ? { submittedAt: requestTime, submittedBy: requester.uid }
        : {}),
      ...(seeded.status === "partially_approved"
        ? {
            reviewedAt: requestTime,
            reviewedBy: administrator.uid,
            approvedAt: requestTime,
            approvedBy: administrator.uid,
          }
        : {}),
      createdAt: requestTime,
      createdBy: requester.uid,
      updatedAt: requestTime,
      updatedBy:
        seeded.status === "partially_approved"
          ? administrator.uid
          : requester.uid,
    },
    { merge: true },
  );
  const snapshotItems = [];
  for (const [productId, requestedQuantity, approvedQuantity] of seeded.items) {
    const product = productById.get(productId);
    const rejectedQuantity =
      seeded.status === "partially_approved"
        ? requestedQuantity - approvedQuantity
        : 0;
    const itemStatus =
      seeded.status === "partially_approved"
        ? approvedQuantity === 0
          ? "rejected"
          : rejectedQuantity === 0
            ? "approved"
            : "partially_approved"
        : "pending";
    const itemId = `${seeded.id}__${encodeURIComponent(productId)}`;
    const item = {
      id: itemId,
      productId,
      sku: product.sku,
      productName: product.name,
      unitOfMeasure: "unit",
      trackingType: product.trackingType,
      requestedQuantity,
      requesterNote: null,
    };
    snapshotItems.push(item);
    batch.set(
      db.doc(`branchRequestItems/${itemId}`),
      {
        organizationId,
        requestId: seeded.id,
        requestNumber: seeded.requestNumber,
        branchId: seeded.branchId,
        categoryId: product.categoryId,
        ...item,
        approvedQuantity,
        rejectedQuantity,
        fulfilledQuantity: 0,
        outstandingQuantity: approvedQuantity,
        transferAllocatedQuantity:
          seeded.id === "seed-request-partial"
            ? productId === "solar-panel-580"
              ? 20
              : productId === "hybrid-inverter-62"
                ? 2
                : 0
            : 0,
        cancelledOutstandingQuantity: 0,
        itemStatus,
        createdAt: requestTime,
        updatedAt: requestTime,
      },
      { merge: true },
    );
  }
  batch.set(
    db.doc(`branchRequestEvents/${seeded.id}-created`),
    {
      organizationId,
      requestId: seeded.id,
      branchId: seeded.branchId,
      eventType: "created",
      newStatus: "draft",
      actorUserId: requester.uid,
      actorRoleId: "branch_requester",
      requestVersion: 0,
      correlationId: `${seeded.id}-created`,
      createdAt: requestTime,
    },
    { merge: true },
  );
  if (seeded.version) {
    batch.set(
      db.doc(`branchRequestVersions/${seeded.id}__v1`),
      {
        organizationId,
        requestId: seeded.id,
        branchId: seeded.branchId,
        version: 1,
        header: {
          requestNumber: seeded.requestNumber,
          requestType: seeded.requestType,
          priority: seeded.priority,
          purpose: seeded.purpose,
        },
        items: snapshotItems,
        submittedBy: requester.uid,
        submittedAt: requestTime,
        correlationId: `${seeded.id}-submitted`,
      },
      { merge: true },
    );
    batch.set(
      db.doc(`branchRequestEvents/${seeded.id}-submitted`),
      {
        organizationId,
        requestId: seeded.id,
        branchId: seeded.branchId,
        eventType: "submitted",
        previousStatus: "draft",
        newStatus: "submitted",
        actorUserId: requester.uid,
        actorRoleId: "branch_requester",
        requestVersion: 1,
        correlationId: `${seeded.id}-submitted`,
        createdAt: requestTime,
      },
      { merge: true },
    );
  }
  if (seeded.status === "partially_approved") {
    batch.set(
      db.doc(`branchRequestApprovals/${seeded.id}-approval`),
      {
        organizationId,
        requestId: seeded.id,
        branchId: seeded.branchId,
        requestVersion: 1,
        stage: "material_review",
        decision: "partially_approved",
        approverId: administrator.uid,
        approverRoleId: "system_administrator",
        itemDecisions: [],
        reason: "Approved against current availability",
        createdAt: requestTime,
        correlationId: `${seeded.id}-approved`,
      },
      { merge: true },
    );
    batch.set(
      db.doc(`branchRequestEvents/${seeded.id}-approved`),
      {
        organizationId,
        requestId: seeded.id,
        branchId: seeded.branchId,
        eventType: "partially_approved",
        previousStatus: "under_review",
        newStatus: "partially_approved",
        actorUserId: administrator.uid,
        actorRoleId: "system_administrator",
        requestVersion: 1,
        correlationId: `${seeded.id}-approved`,
        createdAt: requestTime,
      },
      { merge: true },
    );
  }
  if (seeded.status === "changes_requested")
    batch.set(
      db.doc(`branchRequestEvents/${seeded.id}-changes`),
      {
        organizationId,
        requestId: seeded.id,
        branchId: seeded.branchId,
        eventType: "changes_requested",
        previousStatus: "under_review",
        newStatus: "changes_requested",
        actorUserId: administrator.uid,
        actorRoleId: "system_administrator",
        reason: "Add the missing warranty reference before resubmission",
        requestVersion: 1,
        correlationId: `${seeded.id}-changes`,
        createdAt: requestTime,
      },
      { merge: true },
    );
}
batch.set(
  db.doc(
    `${"organizationCounters"}/${organizationId}_branchRequest_kaduna_2026`,
  ),
  {
    organizationId,
    type: "branchRequest",
    branchId: "kaduna",
    year: 2026,
    value: 4,
    updatedAt: now,
  },
  { merge: true },
);

const transferTime = Timestamp.fromDate(new Date("2026-02-10T08:00:00.000Z"));
const transferBase = (
  id,
  number,
  branchId,
  status,
  planned,
  overrides = {},
) => ({
  organizationId,
  transferNumber: number,
  sourceType: "admin_allocation",
  originWarehouseId: "central",
  originLocationId: "central-main",
  destinationBranchId: branchId,
  destinationLocationId: branchId === "kaduna" ? "kaduna-stock" : "kano-stock",
  transitLocationId: branchId === "kaduna" ? "transit-kaduna" : "transit-kano",
  damagedLocationId: "damaged-kaduna",
  purpose: "Representative emulator transfer",
  priority: "normal",
  status,
  totalPlannedQuantity: planned,
  totalApprovedQuantity: planned,
  totalReservedQuantity: 0,
  totalPickedQuantity: status === "approved" ? 0 : planned,
  totalPackedQuantity: status === "approved" ? 0 : planned,
  totalDispatchedQuantity: ["dispatched", "disputed"].includes(status)
    ? planned
    : 0,
  totalReceivedQuantity: 0,
  totalDamagedQuantity: status === "disputed" ? 1 : 0,
  totalMissingQuantity: status === "disputed" ? 1 : 0,
  totalOutstandingQuantity: planned,
  estimatedCostMinor: 180_000_00,
  approvedCostMinor: 175_000_00,
  actualCostMinor: 182_500_00,
  costVarianceMinor: 7_500_00,
  currency: "NGN",
  initiatedAt: transferTime,
  initiatedBy: administrator.uid,
  version: 1,
  createdAt: transferTime,
  createdBy: administrator.uid,
  updatedAt: transferTime,
  updatedBy: administrator.uid,
  ...overrides,
});
const transfers = [
  [
    "seed-transfer-request",
    "TRF-WH-KD-2026-000001",
    "kaduna",
    "approved",
    22,
    {
      sourceType: "branch_request",
      sourceRequestId: "seed-request-partial",
      sourceRequestVersion: 1,
      sourceApprovalId: "seed-request-partial-approval",
      purpose: "Fulfil approved Kaduna request",
    },
  ],
  [
    "seed-transfer-direct",
    "TRF-WH-KN-2026-000002",
    "kano",
    "approved",
    14,
    { purpose: "Direct Kano replenishment" },
  ],
  [
    "seed-transfer-transit",
    "TRF-WH-KN-2026-000003",
    "kano",
    "dispatched",
    4,
    {
      purpose: "Breakers currently in transit",
      expectedDeliveryDate: Timestamp.fromDate(
        new Date("2026-02-12T17:00:00.000Z"),
      ),
    },
  ],
  [
    "seed-transfer-disputed",
    "TRF-WH-KD-2026-000004",
    "kaduna",
    "disputed",
    2,
    { purpose: "Transfer under discrepancy investigation" },
  ],
];
for (const [id, number, branchId, status, planned, overrides] of transfers) {
  batch.set(
    db.doc(`transfers/${id}`),
    transferBase(id, number, branchId, status, planned, overrides),
    { merge: true },
  );
  batch.set(
    db.doc(`transferEvents/${id}-created`),
    {
      organizationId,
      transferId: id,
      originWarehouseId: "central",
      destinationBranchId: branchId,
      eventType: "created",
      actorUserId: administrator.uid,
      actorRoleId: "system_administrator",
      correlationId: `${id}-created`,
      createdAt: transferTime,
    },
    { merge: true },
  );
}
const transferItems = [
  [
    "seed-transfer-request",
    "solar-panel-580",
    20,
    "seed-request-partial__solar-panel-580",
  ],
  [
    "seed-transfer-request",
    "hybrid-inverter-62",
    2,
    "seed-request-partial__hybrid-inverter-62",
  ],
  ["seed-transfer-direct", "lithium-battery-10", 4, null],
  ["seed-transfer-direct", "dc-breaker-63a", 10, null],
  ["seed-transfer-transit", "dc-breaker-63a", 4, null],
  ["seed-transfer-disputed", "hybrid-inverter-62", 1, null],
  ["seed-transfer-disputed", "lithium-battery-10", 1, null],
];
for (const [transferId, productId, quantity, requestItemId] of transferItems) {
  const product = productById.get(productId);
  const operational = [
    "seed-transfer-transit",
    "seed-transfer-disputed",
  ].includes(transferId);
  batch.set(
    db.doc(`transferItems/${transferId}__${encodeURIComponent(productId)}`),
    {
      organizationId,
      transferId,
      ...(requestItemId
        ? {
            sourceRequestId: "seed-request-partial",
            sourceRequestItemId: requestItemId,
          }
        : {}),
      productId,
      sku: product.sku,
      productName: product.name,
      trackingType: product.trackingType,
      unitOfMeasure: "unit",
      plannedQuantity: quantity,
      approvedQuantity: quantity,
      reservedQuantity: 0,
      pickedQuantity: operational ? quantity : 0,
      packedQuantity: operational ? quantity : 0,
      dispatchedQuantity: operational ? quantity : 0,
      receivedQuantity: 0,
      damagedQuantity:
        transferId === "seed-transfer-disputed" &&
        productId === "hybrid-inverter-62"
          ? 1
          : 0,
      missingQuantity:
        transferId === "seed-transfer-disputed" &&
        productId === "lithium-battery-10"
          ? 1
          : 0,
      rejectedAtReceiptQuantity: 0,
      outstandingQuantity: quantity,
      itemStatus:
        transferId === "seed-transfer-disputed"
          ? "disputed"
          : operational
            ? "dispatched"
            : "approved",
      createdAt: transferTime,
      updatedAt: transferTime,
    },
    { merge: true },
  );
}
batch.set(
  db.doc("transferPackages/seed-package-transit"),
  {
    organizationId,
    transferId: "seed-transfer-transit",
    packageNumber: "TRF-WH-KN-2026-000003-PKG-001",
    status: "dispatched",
    quantity: 4,
    packedBy: administrator.uid,
    checkedBy: requester.uid,
    sealedAt: transferTime,
    createdAt: transferTime,
    updatedAt: transferTime,
  },
  { merge: true },
);
batch.set(
  db.doc("transferPackageItems/seed-package-transit-breakers"),
  {
    organizationId,
    transferId: "seed-transfer-transit",
    packageId: "seed-package-transit",
    transferItemId: "seed-transfer-transit__dc-breaker-63a",
    productId: "dc-breaker-63a",
    sku: "DCB-63A",
    quantity: 4,
    serialItemIds: [],
    createdAt: transferTime,
  },
  { merge: true },
);
batch.set(
  db.doc("transferDispatches/seed-dispatch-transit"),
  {
    organizationId,
    transferId: "seed-transfer-transit",
    dispatchNumber: "TRF-WH-KN-2026-000003-DSP-001",
    originWarehouseId: "central",
    destinationBranchId: "kano",
    driverName: "Musa Ibrahim",
    vehicleRegistration: "KD-482-WH",
    packageIds: ["seed-package-transit"],
    quantity: 4,
    expectedArrivalAt: Timestamp.fromDate(new Date("2026-02-12T17:00:00.000Z")),
    dispatchedAt: transferTime,
    dispatchedBy: administrator.uid,
    verifiedBy: requester.uid,
    status: "in_transit",
    inventoryTransactionIds: ["seed-transfer-dispatch"],
    createdAt: transferTime,
    updatedAt: transferTime,
  },
  { merge: true },
);
batch.set(
  db.doc("vehicles/seed-vehicle-kd482"),
  {
    organizationId,
    name: "Kaduna Delivery Truck",
    registrationNumber: "KD-482-WH",
    vehicleType: "medium_truck",
    capacityKg: 5000,
    active: true,
    createdAt: transferTime,
    createdBy: administrator.uid,
    updatedAt: transferTime,
    updatedBy: administrator.uid,
  },
  { merge: true },
);
batch.set(
  db.doc("drivers/seed-driver-musa"),
  {
    organizationId,
    name: "Musa Ibrahim",
    phoneNumber: "+2348000000000",
    licenseReference: "EMU-LIC-001",
    vendorId: "seed-vendor-north",
    active: true,
    createdAt: transferTime,
    createdBy: administrator.uid,
    updatedAt: transferTime,
    updatedBy: administrator.uid,
  },
  { merge: true },
);
batch.set(
  db.doc("logisticsVendors/seed-vendor-north"),
  {
    organizationId,
    name: "Northern Solar Logistics",
    active: true,
    createdAt: transferTime,
    createdBy: administrator.uid,
    updatedAt: transferTime,
    updatedBy: administrator.uid,
  },
  { merge: true },
);
for (const [id, category, estimate, approved, actual] of [
  ["transport", "transportation", 150_000_00, 145_000_00, 152_500_00],
  ["loading", "loading", 15_000_00, 15_000_00, 15_000_00],
  ["allowance", "driver_allowance", 15_000_00, 15_000_00, 15_000_00],
])
  batch.set(
    db.doc(`transferCosts/seed-transfer-transit-${id}`),
    {
      organizationId,
      transferId: "seed-transfer-transit",
      category,
      description: `Seed ${String(category).replaceAll("_", " ")} cost`,
      estimatedAmountMinor: estimate,
      approvedAmountMinor: approved,
      actualAmountMinor: actual,
      currency: "NGN",
      status: "reconciled",
      createdBy: administrator.uid,
      approvedBy: requester.uid,
      createdAt: transferTime,
      updatedAt: transferTime,
    },
    { merge: true },
  );
for (const [id, type, productId, quantity, sourceLocationId] of [
  ["damaged", "damaged_quantity", "hybrid-inverter-62", 1, "damaged-kaduna"],
  ["missing", "missing_quantity", "lithium-battery-10", 1, "transit-kaduna"],
]) {
  batch.set(
    db.doc(`transferDiscrepancies/seed-discrepancy-${id}`),
    {
      organizationId,
      transferId: "seed-transfer-disputed",
      dispatchId: "seed-dispatch-disputed",
      destinationBranchId: "kaduna",
      type,
      quantity,
      description: `Seed ${String(type).replaceAll("_", " ")} investigation`,
      status: "open",
      reportedBy: requester.uid,
      reportedAt: transferTime,
      sourceLocationId,
      createdAt: transferTime,
      updatedAt: transferTime,
    },
    { merge: true },
  );
  batch.set(
    db.doc(`transferDiscrepancyItems/seed-discrepancy-${id}-item`),
    {
      organizationId,
      transferId: "seed-transfer-disputed",
      dispatchId: "seed-dispatch-disputed",
      discrepancyId: `seed-discrepancy-${id}`,
      transferItemId: `seed-transfer-disputed__${productId}`,
      productId,
      sku: productById.get(productId).sku,
      quantity,
      serialItemIds: [
        uniqueId(organizationId, `${productById.get(productId).sku}-SN-001`),
      ],
      createdAt: transferTime,
    },
    { merge: true },
  );
}

const movements = [
  [
    "seed-transfer-dispatch",
    "INV-2026-000007",
    "dc-breaker-63a",
    "DCB-63A",
    4,
    18_500_00,
    "transit-kano",
    "seed-transfer-transit",
    "transfer_dispatch",
  ],
  [
    "seed-disputed-missing",
    "INV-2026-000008",
    "lithium-battery-10",
    "BAT-10KWH",
    1,
    1_250_000_00,
    "transit-kaduna",
    "seed-transfer-disputed",
    "transfer_dispatch",
  ],
  [
    "seed-disputed-damage",
    "INV-2026-000009",
    "hybrid-inverter-62",
    "INV-6.2K",
    1,
    650_000_00,
    "damaged-kaduna",
    "seed-transfer-disputed",
    "transfer_receipt",
  ],
];
for (const [
  transactionId,
  transactionNumber,
  productId,
  sku,
  quantity,
  unitCostMinor,
  destinationLocationId,
  transferId,
  transactionType,
] of movements) {
  const value = quantity * unitCostMinor;
  batch.set(
    db.doc(`inventoryTransactions/${transactionId}`),
    {
      organizationId,
      transactionNumber,
      transactionType,
      status: "posted",
      referenceType: "transfer",
      referenceId: transferId,
      sourceLocationId: "central-main",
      sourceWarehouseId: "central",
      destinationLocationId,
      destinationBranchId: destinationLocationId.includes("kaduna")
        ? "kaduna"
        : "kano",
      effectiveAt: transferTime,
      postedAt: transferTime,
      postedBy: administrator.uid,
      reason: "Reconciled Phase 4 emulator seed movement",
      idempotencyKey: transactionId,
      correlationId: transactionId,
      createdAt: transferTime,
      createdBy: administrator.uid,
    },
    { merge: true },
  );
  batch.set(db.doc(`inventoryEntries/${transactionId}-source`), {
    organizationId,
    transactionId,
    transactionNumber,
    transactionType,
    productId,
    sku,
    locationId: "central-main",
    warehouseId: "central",
    counterpartyLocationId: destinationLocationId,
    quantityDelta: -quantity,
    unitCostMinor,
    valueDeltaMinor: -value,
    currency: "NGN",
    effectiveAt: transferTime,
    postedBy: administrator.uid,
    reason: "Reconciled Phase 4 emulator seed movement",
    createdAt: transferTime,
  });
  batch.set(db.doc(`inventoryEntries/${transactionId}-destination`), {
    organizationId,
    transactionId,
    transactionNumber,
    transactionType,
    productId,
    sku,
    locationId: destinationLocationId,
    branchId: destinationLocationId.includes("kaduna") ? "kaduna" : "kano",
    counterpartyLocationId: "central-main",
    quantityDelta: quantity,
    unitCostMinor,
    valueDeltaMinor: value,
    currency: "NGN",
    effectiveAt: transferTime,
    postedBy: administrator.uid,
    reason: "Reconciled Phase 4 emulator seed movement",
    createdAt: transferTime,
  });
  batch.set(
    db.doc(`inventoryBalances/${balanceId(productId, destinationLocationId)}`),
    {
      organizationId,
      productId,
      sku,
      locationId: destinationLocationId,
      branchId: destinationLocationId.includes("kaduna") ? "kaduna" : "kano",
      onHandQuantity: quantity,
      reservedQuantity: 0,
      availableQuantity: quantity,
      averageUnitCostMinor: unitCostMinor,
      totalValueMinor: value,
      currency: "NGN",
      lastTransactionId: transactionId,
      lastMovementAt: transferTime,
      version: 1,
      createdAt: transferTime,
      updatedAt: transferTime,
    },
    { merge: true },
  );
}
batch.set(
  db.doc("system/bootstrap"),
  {
    completed: true,
    organizationId,
    administratorUid: administrator.uid,
    completedAt: now,
    completedBy: "seed:emulator",
    version: 1,
  },
  { merge: true },
);
batch.set(
  db.collection("auditLogs").doc("development-seed"),
  {
    organizationId,
    actorUserId: administrator.uid,
    actorRoleId: "system_administrator",
    action: "emulator.seeded",
    entityType: "organization",
    entityId: organizationId,
    correlationId: "development-seed",
    sourceFunction: "seed:emulator",
    createdAt: now,
  },
  { merge: true },
);
await batch.commit();
console.log(
  `Emulator seed ready with ${products.length} products and balanced opening entries. Login: ${adminEmail} / EmulatorOnly!234567`,
);
