import type { Firestore } from "firebase-admin/firestore";
import { gmailSupportTransport } from "./mail.js";
import { deliverSupportNotification, type SupportTransport } from "./store.js";

/** Bounded scan. No secret read on an empty queue; no automatic replay of uncertain mail. */
export async function runSupportMailBatch(db: Firestore, readPassword: () => string, factory: (password: string) => SupportTransport = gmailSupportTransport) {
  const stale = await db.collection("supportMailOutbox").where("state", "==", "sending").limit(10).get();
  for (const row of stale.docs) await deliverSupportNotification(db, row.id);
  const queue = await db.collection("supportMailOutbox").where("state", "in", ["pending", "unconfigured"]).limit(1).get();
  if (queue.empty) return;
  let transport: SupportTransport | undefined;
  try { const password = readPassword(); transport = password ? factory(password) : undefined; } catch { transport = undefined; }
  await deliverSupportNotification(db, queue.docs[0]!.id, transport);
}
