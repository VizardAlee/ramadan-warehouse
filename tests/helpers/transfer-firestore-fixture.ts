import { createRequire } from "node:module";
import { Timestamp } from "firebase-admin/firestore";

// Functions and the web project can install separate copies of the Admin SDK.
// Match sentinels against the same public API instance as the server code.
const { FieldValue } = createRequire(new URL("../../functions/package.json", import.meta.url))("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

type Row = Record<string, unknown>;
type Ref = { path: string; id: string; get: () => Promise<Snapshot> };
type Snapshot = { id: string; ref: Ref; exists: boolean; get: (field: string) => unknown; data: () => Row | undefined };
type Filter = [string, string, unknown];

// Offline callable fixture: staged writes roll back on errors, reads after writes
// fail, and a discarded attempt can model Firestore rerunning a transaction.
// Transactions are serialized; this does not emulate Firestore contention.
export class TransferFirestoreFixture {
  rows = new Map<string, Row>();
  retryNext = false;
  failNextCommitFor = "";
  failNextCommandCompletion = false;
  private sequence = 0;
  private queue: Promise<unknown> = Promise.resolve();

  doc = (path: string): Ref => ({ path, id: path.split("/").at(-1)!, get: async () => this.snapshot(path) });
  seed(path: string, values: Row) { this.rows.set(path, values); }
  row(path: string) { return this.rows.get(path)!; }
  all(collection: string) {
    return [...this.rows].filter(([path]) => path.split("/").length === 2 && path.startsWith(`${collection}/`)).map(([, values]) => values);
  }
  private snapshot(path: string): Snapshot {
    const values = this.rows.get(path);
    return { id: this.doc(path).id, ref: this.doc(path), exists: Boolean(values), get: field => values?.[field], data: () => values };
  }
  collection = (path: string) => {
    const query = (filters: Filter[] = [], count = Infinity, cursor?: string) => ({
      doc: (id = `fixture-${++this.sequence}`) => this.doc(`${path}/${id}`),
      where: (field: string, operation: string, value: unknown) => query([...filters, [field, operation, value]], count, cursor),
      orderBy: () => query(filters, count, cursor),
      limit: (value: number) => query(filters, value, cursor),
      startAfter: (value: string) => query(filters, count, value),
      get: async () => {
        const docs = [...this.rows.keys()].sort().filter(key => {
          if (!key.startsWith(`${path}/`) || key.split("/").length !== 2 || (cursor && this.doc(key).id <= cursor)) return false;
          return filters.every(([field, operation, value]) => {
            const actual = this.row(key)[field];
            if (operation === "==") return actual === value;
            if (operation === "in") {
              if ((value as unknown[]).length > 30) throw new Error("Firestore in-query limit exceeded");
              return (value as unknown[]).includes(actual);
            }
            throw new Error(`Unsupported fixture filter: ${operation}`);
          });
        }).slice(0, count).map(key => this.snapshot(key));
        return { docs, size: docs.length, empty: !docs.length };
      },
    });
    return query();
  };
  getAll = async (...refs: Ref[]) => refs.map(ref => this.snapshot(ref.path));
  runTransaction = async (handler: (tx: ReturnType<TransferFirestoreFixture["transaction"]>) => Promise<unknown>) => {
    const operation = this.queue.then(async () => {
      if (this.retryNext) {
        this.retryNext = false;
        await handler(this.transaction()); // Discard every staged write.
      }
      const tx = this.transaction();
      const result = await handler(tx);
      tx.commit();
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  };
  private transaction() {
    const writes: Array<{ ref: Ref; values: Row; mode: "create" | "update" | "set"; merge?: boolean }> = [];
    const read = () => { if (writes.length) throw new Error("Firestore reads must precede writes"); };
    return {
      get: async <T>(target: { get: () => Promise<T> }): Promise<T> => { read(); return target.get(); },
      getAll: async (...refs: Ref[]) => { read(); return this.getAll(...refs); },
      create: (ref: Ref, values: Row) => { writes.push({ ref, values, mode: "create" }); },
      update: (ref: Ref, values: Row) => { writes.push({ ref, values, mode: "update" }); },
      set: (ref: Ref, values: Row, options?: { merge: boolean }) => { writes.push({ ref, values, mode: "set", merge: options?.merge }); },
      commit: () => {
        if (this.failNextCommandCompletion && writes.some(write => write.ref.path.includes("_transferCommand_") && write.values.status === "completed")) {
          this.failNextCommandCompletion = false;
          throw new Error("Injected command-cache completion failure after business commit");
        }
        if (this.failNextCommitFor && writes.some(write => write.ref.path.startsWith(this.failNextCommitFor))) {
          this.failNextCommitFor = "";
          throw new Error("Injected transaction-finalization failure");
        }
        const next = new Map(this.rows);
        for (const { ref, values, mode, merge } of writes) {
          if (mode === "create" && next.has(ref.path)) throw new Error(`Document already exists: ${ref.path}`);
          if (mode === "update" && !next.has(ref.path)) throw new Error(`Document missing: ${ref.path}`);
          const output = { ...(mode === "update" || merge ? next.get(ref.path) : {}), ...values };
          for (const [field, value] of Object.entries(output)) {
            if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) delete output[field];
            if (value instanceof FieldValue && value.isEqual(FieldValue.serverTimestamp())) output[field] = Timestamp.now();
          }
          next.set(ref.path, output);
        }
        this.rows = next;
      },
    };
  }
}
