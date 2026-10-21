import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
vi.mock("../functions/src/admin", () => ({ db: {} }));
import { runSupportMailBatch } from "../functions/src/support/dispatch";
import { SupportMemoryFirestore } from "./helpers/support-memory-firestore";
const id = (n: number) => "RS-" + n.toString(16).padStart(32, "0");
function setup() {
  const memory = new SupportMemoryFirestore(); memory.seed("organizations/org", { status: "active" });
  const seed = (n: number, state = "pending") => { memory.seed("supportOrganizations/org/tickets/" + id(n), { id: id(n), organizationId: "org", ownerUid: "owner", scope: { type: "branch", id: "one" }, kind: "bug", description: "Synthetic report", expected: "", context: {}, hasScreenshot: false }); memory.seed("supportMailOutbox/" + id(n), { organizationId: "org", ticketId: id(n), state, attempts: 0, leaseUntil: 1 }); };
  return { memory, db: memory as unknown as Firestore, seed };
}
describe("bounded support mail dispatch", () => {
  it("does not read a credential on an empty queue", async () => {
    const { db } = setup(), secret = vi.fn(); await runSupportMailBatch(db, secret); expect(secret).not.toHaveBeenCalled();
  });
  it("checks at most ten interrupted claims and attempts one pending report per run", async () => {
    const { db, memory, seed } = setup(); for (let n = 1; n <= 15; n++) seed(n, "sending"); for (let n = 16; n <= 35; n++) seed(n);
    const send = vi.fn(async () => ({ accepted: true as const, providerReference: "synthetic" })), factory = vi.fn(() => ({ send }));
    await runSupportMailBatch(db, () => "synthetic-fixture", factory);
    expect(memory.querySizes).toEqual([10,1]); expect(send).toHaveBeenCalledOnce(); expect(factory).toHaveBeenCalledOnce();
    expect([...memory.rows].filter(([path,row]) => path.startsWith("supportMailOutbox/") && row.state === "uncertain")).toHaveLength(10);
  });
  it.each(["missing", "unavailable", "invalid"])("survives a %s provider without losing the ticket or claiming SMTP delivery", async mode => {
    const { db, memory, seed } = setup(); seed(1);
    const secret = () => { if (mode === "unavailable") throw Error("Synthetic unavailable secret"); return mode === "missing" ? "" : "bad-synthetic-fixture"; };
    const factory = vi.fn(() => { throw Error("Synthetic invalid transport configuration"); });
    await runSupportMailBatch(db, secret, factory);
    expect(memory.rows.get("supportMailOutbox/" + id(1))).toMatchObject({ state: "unconfigured", attempts: 0 });
    expect(memory.rows.has("supportOrganizations/org/tickets/" + id(1))).toBe(true);
  });
});
