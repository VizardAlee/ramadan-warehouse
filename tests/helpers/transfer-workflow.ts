import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { uniquenessDocumentId } from "../../functions/src/inventory/calculations";

export const emulatorProjectId = "demo-ramadan-warehouse";

export interface TestActor {
  uid: string;
  auth: ReturnType<typeof getAuth>;
  functions: ReturnType<typeof getFunctions>;
}

export async function call<T = Record<string, unknown>>(
  actor: TestActor,
  name: string,
  data: Record<string, unknown>,
): Promise<T> {
  return (await httpsCallable(actor.functions, name)(data)).data as T;
}

export interface TransferHarness {
  organizationId: string;
  db: ReturnType<typeof getFirestore>;
  creator: TestActor;
  manager: TestActor;
  picker: TestActor;
  logistics: TestActor;
  receiver: TestActor;
  unauthorized: TestActor;
  foreign: TestActor;
  productId: string;
  originLocationId: string;
  destinationLocationId: string;
  returnLocationId: string;
  transitLocationId: string;
  serialIds: string[];
  prepareTransfer(
    quantity: number,
    packageQuantities: number[],
    selectedSerialIds?: string[],
  ): Promise<{ transferId: string; transferItemId: string; packageIds: string[] }>;
  dispatch(
    transferId: string,
    packageIds: string[],
    idempotencyKey?: string,
  ): Promise<{ dispatchId: string; confirmKey: string }>;
  cleanup(): Promise<void>;
}

export async function setupTransferHarness(options: {
  suffix: string;
  openingQuantity: number;
  trackingType?: "quantity" | "serial";
  serialNumbers?: string[];
}): Promise<TransferHarness> {
  const organizationId = `acceptance-${options.suffix}-org`;
  const productId = `${options.suffix}-product`;
  const warehouseId = `${options.suffix}-warehouse`;
  const branchId = `${options.suffix}-branch`;
  const originLocationId = `${options.suffix}-origin`;
  const destinationLocationId = `${options.suffix}-destination`;
  const returnLocationId = `${options.suffix}-returned`;
  const transitLocationId = `transit__${organizationId}__${branchId}`;
  const adminName = `acceptance-${options.suffix}`;
  const adminApp =
    getAdminApps().find((app) => app.name === adminName) ??
    initializeAdminApp({ projectId: emulatorProjectId }, adminName);
  const adminAuth = getAdminAuth(adminApp);
  const db = getFirestore(adminApp);
  const apps: FirebaseApp[] = [];

  await fetch(
    `http://127.0.0.1:9099/emulator/v1/projects/${emulatorProjectId}/accounts`,
    { method: "DELETE" },
  );
  await fetch(
    `http://127.0.0.1:8180/emulator/v1/projects/${emulatorProjectId}/databases/(default)/documents`,
    { method: "DELETE" },
  );

  const makeActor = async (
    name: string,
    roleId: string,
    actorOrganizationId = organizationId,
    branchIds: string[] = [],
    warehouseIds: string[] = [],
  ) => {
    const email = `${options.suffix}-${name}@example.test`;
    const user = await adminAuth.createUser({ email, password: "Password!234567" });
    await db.doc(`users/${user.uid}`).set({
      uid: user.uid,
      organizationId: actorOrganizationId,
      email,
      displayName: name,
      roleId,
      branchIds,
      warehouseIds,
      status: "active",
      authDisabled: false,
      authorizationVersion: 1,
    });
    const app = initializeApp(
      { projectId: emulatorProjectId, apiKey: "demo", appId: `${options.suffix}-${name}` },
      `${options.suffix}-${name}`,
    );
    apps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    const functions = getFunctions(app, "us-central1");
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    await signInWithEmailAndPassword(auth, email, "Password!234567");
    return { uid: user.uid, auth, functions };
  };

  await Promise.all([
    db.doc(`organizations/${organizationId}`).set({ name: options.suffix, status: "active" }),
    db.doc(`warehouses/${warehouseId}`).set({ organizationId, name: "Central", code: "CEN", status: "active" }),
    db.doc(`branches/${branchId}`).set({ organizationId, name: "Kaduna", code: "KAD", status: "active" }),
    db.doc(`inventoryLocations/${originLocationId}`).set({ organizationId, warehouseId, name: "Available", code: "AVL", type: "warehouse", status: "active" }),
    db.doc(`inventoryLocations/${destinationLocationId}`).set({ organizationId, branchId, name: "Branch available", code: "BRA", type: "branch", status: "active" }),
    db.doc(`inventoryLocations/${returnLocationId}`).set({ organizationId, warehouseId, name: "Returned quarantine", code: "RET", type: "returned", status: "active" }),
    db.doc(`products/${productId}`).set({ organizationId, name: "Acceptance product", sku: `SKU-${options.suffix}`, unitOfMeasure: "unit", trackingType: options.trackingType ?? "quantity", active: true, hasLedgerActivity: false }),
    db.doc(`productCosts/${productId}`).set({ organizationId, productId, defaultUnitCostMinor: 10_000, currency: "NGN" }),
  ]);

  const creator = await makeActor("creator", "system_administrator");
  const manager = await makeActor("manager", "warehouse_manager", organizationId, [], [warehouseId]);
  const picker = await makeActor("picker", "warehouse_officer", organizationId, [], [warehouseId]);
  const logistics = await makeActor("logistics", "logistics_officer", organizationId, [], [warehouseId]);
  const receiver = await makeActor("receiver", "branch_manager", organizationId, [branchId]);
  const unauthorized = await makeActor("requester", "branch_requester", organizationId, [branchId]);
  const foreign = await makeActor("foreign", "system_administrator", `${organizationId}-foreign`);
  const serialNumbers = options.serialNumbers ?? [];
  const serialIds = serialNumbers.map((value) => uniquenessDocumentId(organizationId, value));
  await call(creator, "postOpeningStock", {
    productId,
    destinationLocationId: originLocationId,
    quantity: options.openingQuantity,
    unitCostMinor: 10_000,
    serialNumbers,
    effectiveAt: new Date().toISOString(),
    reason: "Acceptance opening stock",
    externalAccount: "migration",
    idempotencyKey: crypto.randomUUID(),
  });

  const prepareTransfer: TransferHarness["prepareTransfer"] = async (
    quantity,
    packageQuantities,
    selectedSerialIds = [],
  ) => {
    const created = await call<{ transferId: string }>(creator, "createAdminTransfer", {
      originWarehouseId: warehouseId,
      originLocationId,
      destinationBranchId: branchId,
      destinationLocationId,
      purpose: "Phase 5.1 local acceptance",
      priority: "high",
      items: [{ productId, quantity }],
      directTransferReason: "Controlled acceptance workflow",
      idempotencyKey: crypto.randomUUID(),
    });
    const transferId = created.transferId;
    const transferItemId = `${transferId}__${productId}`;
    await call(creator, "submitTransfer", { transferId, expectedVersion: 0, idempotencyKey: crypto.randomUUID() });
    await call(manager, "approveTransfer", { transferId, expectedVersion: 1, idempotencyKey: crypto.randomUUID() });
    await call(manager, "reserveTransferStock", {
      transferId,
      expectedVersion: 1,
      lines: [{ transferItemId, productId, quantity, serialItemIds: selectedSerialIds, lotAllocations: [] }],
      idempotencyKey: crypto.randomUUID(),
    });
    await call(picker, "startTransferPicking", { transferId, expectedVersion: 1, idempotencyKey: crypto.randomUUID() });
    const pick = await call<{ pickId: string }>(picker, "recordPickedItems", {
      transferId,
      expectedVersion: 1,
      lines: [{ transferItemId, quantity, serialItemIds: selectedSerialIds, lotAllocations: [] }],
      idempotencyKey: crypto.randomUUID(),
    });
    await call(manager, "verifyPickedItems", { transferId, expectedVersion: 1, pickId: pick.pickId, accepted: true, idempotencyKey: crypto.randomUUID() });
    const packageIds: string[] = [];
    let serialOffset = 0;
    for (const packageQuantity of packageQuantities) {
      const packageSerials = selectedSerialIds.slice(serialOffset, serialOffset + packageQuantity);
      serialOffset += packageQuantity;
      const pkg = await call<{ packageId: string }>(picker, "createTransferPackage", {
        transferId,
        expectedVersion: 1,
        lines: [{ transferItemId, quantity: packageQuantity, serialItemIds: packageSerials, lotAllocations: [] }],
        idempotencyKey: crypto.randomUUID(),
      });
      packageIds.push(pkg.packageId);
    }
    for (const packageId of packageIds) {
      await call(picker, "sealTransferPackage", { transferId, expectedVersion: 1, packageId, idempotencyKey: crypto.randomUUID() });
      await call(manager, "verifyPacking", { transferId, expectedVersion: 1, packageId, idempotencyKey: crypto.randomUUID() });
    }
    return { transferId, transferItemId, packageIds };
  };

  const dispatch: TransferHarness["dispatch"] = async (
    transferId,
    packageIds,
    idempotencyKey = crypto.randomUUID(),
  ) => {
    const base = { transferId, expectedVersion: 1, packageIds, driverName: "Acceptance Driver", verifiedBy: manager.uid };
    const created = await call<{ dispatchId: string }>(logistics, "createTransferDispatch", { ...base, idempotencyKey: crypto.randomUUID() });
    await call(logistics, "confirmTransferDispatch", { ...base, dispatchId: created.dispatchId, idempotencyKey });
    return { dispatchId: created.dispatchId, confirmKey: idempotencyKey };
  };

  return {
    organizationId,
    db,
    creator,
    manager,
    picker,
    logistics,
    receiver,
    unauthorized,
    foreign,
    productId,
    originLocationId,
    destinationLocationId,
    returnLocationId,
    transitLocationId,
    serialIds,
    prepareTransfer,
    dispatch,
    cleanup: async () => {
      await Promise.all(apps.map((app) => deleteApp(app)));
    },
  };
}
