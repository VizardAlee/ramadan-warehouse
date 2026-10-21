/** Transactional test double: rejects reads after writes and commits atomically.
 * Does not replace the real SDK/emulator gate or claim to model server contention. */
type Row = Record<string, unknown>;
class Snapshot {
  constructor(public ref: Ref, private value?: Row) {}
  get id() { return this.ref.id; }
  get exists() { return this.value !== undefined; }
  data() { return this.value === undefined ? undefined : structuredClone(this.value); }
  get(field: string) { return this.value?.[field]; }
}
class Ref {
  constructor(public db: SupportMemoryFirestore, public path: string) {}
  get id() { return this.path.split("/").at(-1)!; }
  collection(name: string) { return new Query(this.db, this.path + "/" + name); }
  async get() { this.db.reads.push(this.path); return new Snapshot(this, this.db.rows.get(this.path)); }
}
class Query {
  constructor(public db: SupportMemoryFirestore, public path: string, private orders: [string, string][] = [], private count = Infinity, private cursor?: unknown[], private filters: [string, string, unknown][] = []) {}
  doc(id = "generated-" + this.db.sequence++) { return new Ref(this.db, this.path + "/" + id); }
  orderBy(field: string, direction = "asc"): Query { return new Query(this.db, this.path, [...this.orders, [field, direction]], this.count, this.cursor, this.filters); }
  limit(count: number) { return new Query(this.db, this.path, this.orders, count, this.cursor, this.filters); }
  startAfter(...cursor: unknown[]) { return new Query(this.db, this.path, this.orders, this.count, cursor, this.filters); }
  where(field: string, operation: string, value: unknown) { return new Query(this.db, this.path, this.orders, this.count, this.cursor, [...this.filters, [field, operation, value]]); }
  async get() {
    const depth = this.path.split("/").length + 1;
    let rows = [...this.db.rows].filter(([path]) => path.startsWith(this.path + "/") && path.split("/").length === depth).map(([path, value]) => new Snapshot(new Ref(this.db, path), value));
    rows = rows.filter(row => this.filters.every(([field, operation, value]) => operation === "==" ? row.get(field) === value : operation === "in" && Array.isArray(value) && value.includes(row.get(field))));
    const compare = (a: Snapshot, values: unknown[]) => {
      for (let i = 0; i < this.orders.length; i++) { const [field, direction] = this.orders[i]!, av = field === "__name__" ? a.id : a.get(field), bv = values[i]; if (av === bv) continue; const c = typeof av === "number" && typeof bv === "number" ? Math.sign(av - bv) : String(av) < String(bv) ? -1 : 1; return direction === "desc" ? -c : c; }
      return 0;
    };
    rows.sort((a,b) => compare(a, this.orders.map(([field]) => field === "__name__" ? b.id : b.get(field))));
    if (this.cursor) rows = rows.filter(row => compare(row, this.cursor!) > 0);
    rows = rows.slice(0, this.count); this.db.querySizes.push(rows.length);
    return { docs: rows, empty: rows.length === 0 };
  }
}
export class SupportMemoryFirestore {
  rows = new Map<string, Row>(); reads: string[] = []; querySizes: number[] = []; sequence = 1; failCommit = false;
  private serial: Promise<unknown> = Promise.resolve();
  doc(path: string) { return new Ref(this, path); }
  collection(path: string) { return new Query(this, path); }
  async getAll(...refs: Ref[]) { return Promise.all(refs.map(ref => ref.get())); }
  seed(path: string, value: Row) { this.rows.set(path, structuredClone(value)); }
  runTransaction<T>(work: (tx: { get(ref: Ref): Promise<Snapshot>; create(ref: Ref, value: Row): void; update(ref: Ref, patch: Row): void; set(ref: Ref, value: Row): void }) => Promise<T>): Promise<T> {
    const run = this.serial.then(async () => {
      const next = new Map([...this.rows].map(([path, row]) => [path, structuredClone(row)])); let writing = false;
      const result = await work({
        get: async ref => { if (writing) throw Error("Read after transaction write"); this.reads.push(ref.path); return new Snapshot(ref, next.get(ref.path)); },
        create: (ref, value) => { writing = true; if (next.has(ref.path)) throw Error("Document already exists"); next.set(ref.path, structuredClone(value)); },
        update: (ref, patch) => { writing = true; if (!next.has(ref.path)) throw Error("Missing document"); next.set(ref.path, { ...next.get(ref.path)!, ...structuredClone(patch) }); },
        set: (ref, value) => { writing = true; next.set(ref.path, structuredClone(value)); },
      });
      if (this.failCommit) throw Error("Synthetic commit failure");
      this.rows = next; return result;
    });
    this.serial = run.then(() => undefined, () => undefined); return run;
  }
}
