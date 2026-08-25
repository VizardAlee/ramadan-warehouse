import type { PosWorkspace, QueuedPosSale } from "./types";

const databaseName = "abr-pos-v1";
const databaseVersion = 1;
const workspaceStore = "workspaces";
const queueStore = "salesQueue";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(workspaceStore))
        database.createObjectStore(workspaceStore);
      if (!database.objectStoreNames.contains(queueStore))
        database.createObjectStore(queueStore, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("POS storage failed."));
  });
}

async function transact<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = run(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("POS storage failed."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error("POS storage failed."));
  });
}

export function saveCachedWorkspace(userId: string, workspace: PosWorkspace) {
  return transact(workspaceStore, "readwrite", (store) =>
    store.put(workspace, `${userId}:${workspace.branch.id}`),
  );
}

export function readCachedWorkspace(userId: string, branchId: string) {
  return transact<PosWorkspace | undefined>(workspaceStore, "readonly", (store) =>
    store.get(`${userId}:${branchId}`),
  );
}

export function queueOfflineSale(sale: QueuedPosSale) {
  return transact(queueStore, "readwrite", (store) => store.put(sale));
}

export function updateQueuedSale(sale: QueuedPosSale) {
  return transact(queueStore, "readwrite", (store) => store.put(sale));
}

export function removeQueuedSale(id: string) {
  return transact(queueStore, "readwrite", (store) => store.delete(id));
}

export async function listQueuedSales(branchId?: string, userId?: string) {
  const all = await transact<QueuedPosSale[]>(queueStore, "readonly", (store) =>
    store.getAll(),
  );
  return all
    .filter(
      (sale) =>
        (!branchId || sale.branchId === branchId) &&
        (!userId || sale.userId === userId),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
