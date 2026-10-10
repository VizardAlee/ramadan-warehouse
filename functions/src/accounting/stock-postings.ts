import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import type { AccessProfile } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import type { InventoryPostingExtension } from "../inventory/post-inventory-transaction.js";
import type { SupplierReturnReversalExtension } from "../inventory/reverse-inventory-posting.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "./period-lock.js";
import { writeJournal } from "./write-journal.js";

type Kind = "opening_balance" | "stock_adjustment" | "stock_count_correction";
const names: Record<string, string> = { "1200": "Inventory asset", "3100": "Opening stock equity clearing", "5200": "Stock adjustments and count variances" };
const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };

export function stockJournalLines(kind: Kind, issue: boolean, value: number) {
  if (!Number.isSafeInteger(value) || value < 0) fail("The stock movement value requires reconciliation.");
  if (kind === "opening_balance" && issue) fail("Opening stock cannot issue goods.");
  if (!value) return [];
  const offset = kind === "opening_balance" ? "3100" : "5200";
  return [
    { accountCode: "1200", accountName: names["1200"], debitMinor: issue ? 0 : value, creditMinor: issue ? value : 0 },
    { accountCode: offset, accountName: names[offset], debitMinor: issue ? value : 0, creditMinor: issue ? 0 : value },
  ];
}

/** Uses the stock engine's actual valuation, in its existing atomic transaction. */
export function stockAccounting(actor: AccessProfile, kind: Kind, reason: string, correlationId: string, sourceFunction: string): InventoryPostingExtension<{
  sequence: number; missingAccounts: string[];
}> {
  const journal = db.collection("journalEntries").doc();
  const counter = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`);
  return {
    async prepare(reader, movement) {
      const lines = stockJournalLines(kind, Boolean(movement.sourceLocationId), movement.movementValueMinor);
      const accounts = lines.map(line => db.doc(`chartOfAccounts/${uniquenessDocumentId(actor.organizationId, line.accountCode)}`));
      const [period, sequence, ...current] = await reader.getAll(accountingPeriodReference(actor.organizationId, movement.effectiveAt), counter, ...accounts);
      assertAccountingPeriodOpen(period!);
      current.forEach((account, index) => {
        const code = lines[index]!.accountCode;
        if (account.exists && (account.get("organizationId") !== actor.organizationId || account.get("code") !== code || account.get("active") === false || (account.get("currency") && account.get("currency") !== "NGN") ||
          (code !== "1200" && account.get("systemManaged") !== true)))
          fail(`Accounting account ${code} requires authorized reconciliation before this stock posting.`);
      });
      return { sequence: Number(sequence!.get("value") ?? 0) + 1, missingAccounts: current.flatMap((account, index) => account.exists ? [] : [lines[index]!.accountCode]) };
    },
    apply(writer, state, movement) {
      const lines = stockJournalLines(kind, Boolean(movement.sourceLocationId), movement.movementValueMinor);
      for (const code of state.missingAccounts) writer.create(db.doc(`chartOfAccounts/${uniquenessDocumentId(actor.organizationId, code)}`), {
        organizationId: actor.organizationId, code, name: names[code], currency: "NGN", active: true, systemManaged: true,
      });
      const journalNumber = lines.length ? writeJournal(writer, actor, {
        journal, journalCounter: counter, journalCounterValue: state.sequence, journalType: `inventory_${kind}`,
        referenceType: "inventoryTransaction", referenceId: movement.transactionId, referenceNumber: movement.transactionNumber,
        description: reason, branchId: movement.sourceBranchId ?? movement.destinationBranchId,
        warehouseId: movement.sourceWarehouseId ?? movement.destinationWarehouseId, effectiveAt: movement.effectiveAt,
        manageAccounts: false, lines,
        details: { inventoryTransactionId: movement.transactionId, productId: movement.productId, quantity: movement.quantity, nonCash: true },
      }) : null;
      writer.update(db.doc(`inventoryTransactions/${movement.transactionId}`), {
        accountingVersion: 2, accountingValueMinor: movement.movementValueMinor, journalEntryId: lines.length ? journal.id : null, journalNumber,
      });
      if (lines.length) writeAuditLog(writer, actor, { action: "accounting.stock_posted", entityType: "journalEntry", entityId: journal.id,
        correlationId, sourceFunction, reason, after: { inventoryTransactionId: movement.transactionId, journalNumber, valueMinor: movement.movementValueMinor, nonCash: true } });
      return undefined;
    },
  };
}

/** Old stock-only postings remain old; never invent a journal for historical data. */
export async function stockAccountingReversal(actor: AccessProfile, transactionId: string, reason: string, correlationId: string): Promise<SupplierReturnReversalExtension<{
  sequence: number; kind: Kind; value: number; originalJournalId: string; issue: boolean;
}> | undefined> {
  const original = await db.doc(`inventoryTransactions/${transactionId}`).get();
  if (original.get("accountingVersion") !== 2 || original.get("accountingValueMinor") === 0) return undefined;
  const journal = db.collection("journalEntries").doc(), counter = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`);
  const effectiveAt = Timestamp.now();
  return {
    effectiveAt, sourceFunction: "reverseInventoryTransaction",
    async prepare(reader, movement) {
      const current = movement.original, kind = current.get("transactionType") as Kind, value = Number(current.get("accountingValueMinor"));
      if (current.get("accountingVersion") !== 2 || !["opening_balance", "stock_adjustment", "stock_count_correction"].includes(kind) || !current.get("journalEntryId"))
        fail("This stock transaction requires its original linked accounting correction.");
      const originalJournalId = String(current.get("journalEntryId"));
      const [period, sequence, originalJournal, entries] = await Promise.all([
        reader.get(accountingPeriodReference(actor.organizationId, effectiveAt)), reader.get(counter), reader.get(db.doc(`journalEntries/${originalJournalId}`)),
        reader.get(db.collection("journalLines").where("journalEntryId", "==", originalJournalId).limit(3)),
      ]);
      assertAccountingPeriodOpen(period);
      const issue = Boolean(current.get("sourceLocationId")), expected = stockJournalLines(kind, issue, value);
      if (originalJournal.get("organizationId") !== actor.organizationId || originalJournal.get("referenceId") !== current.id || originalJournal.get("referenceType") !== "inventoryTransaction" ||
        originalJournal.get("journalType") !== `inventory_${kind}` || originalJournal.get("status") !== "posted" || originalJournal.get("totalDebitMinor") !== value || originalJournal.get("totalCreditMinor") !== value ||
        originalJournal.get("branchId") !== (current.get("sourceBranchId") ?? current.get("destinationBranchId")) || originalJournal.get("warehouseId") !== (current.get("sourceWarehouseId") ?? current.get("destinationWarehouseId")) ||
        originalJournal.get("reversalJournalEntryId") || entries.size !== expected.length ||
        expected.some(line => !entries.docs.some(entry => entry.get("organizationId") === actor.organizationId && entry.get("accountCode") === line.accountCode && entry.get("debitMinor") === line.debitMinor && entry.get("creditMinor") === line.creditMinor)))
        fail("The original stock journal requires reconciliation before reversal.");
      return { sequence: Number(sequence.get("value") ?? 0) + 1, kind, value, originalJournalId, issue };
    },
    apply(writer, state, movement) {
      const lines = stockJournalLines(state.kind, state.issue, state.value).map(line => ({ ...line, debitMinor: line.creditMinor, creditMinor: line.debitMinor }));
      const journalNumber = writeJournal(writer, actor, { journal, journalCounter: counter, journalCounterValue: state.sequence,
        journalType: "inventory_reversal", referenceType: "inventoryTransaction", referenceId: movement.transactionId, referenceNumber: movement.transactionNumber,
        description: reason, branchId: movement.original.get("sourceBranchId") ?? movement.original.get("destinationBranchId"),
        warehouseId: movement.original.get("sourceWarehouseId") ?? movement.original.get("destinationWarehouseId"), effectiveAt, manageAccounts: false, lines,
        details: { reversalOfJournalEntryId: state.originalJournalId, reversalOfInventoryTransactionId: movement.original.id, nonCash: true } });
      writer.update(db.doc(`inventoryTransactions/${movement.transactionId}`), { accountingVersion: 2, accountingValueMinor: state.value, journalEntryId: journal.id, journalNumber });
      writer.update(db.doc(`journalEntries/${state.originalJournalId}`), { reversalJournalEntryId: journal.id, reversalInventoryTransactionId: movement.transactionId });
      writeAuditLog(writer, actor, { action: "accounting.stock_reversed", entityType: "journalEntry", entityId: journal.id,
        correlationId, sourceFunction: "reverseInventoryTransaction", reason, after: { originalJournalEntryId: state.originalJournalId, inventoryTransactionId: movement.transactionId, journalNumber } });
      return undefined;
    },
  };
}
