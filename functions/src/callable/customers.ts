import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import {
  hasRole,
  requireAccess,
  requireBranchScope,
  requirePermission,
} from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { assertBalancedJournal } from "../sales/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import {
  customerPaymentInput,
  decideCustomerCreditInput,
  saveCustomerInput,
} from "../validation/sales.js";

const paymentAccount: Readonly<Record<string, { code: string; name: string }>> = {
  cash: { code: "1010", name: "Cash on hand" },
  card: { code: "1020", name: "Card clearing" },
  bank_transfer: { code: "1030", name: "Bank transfer clearing" },
};

function clean(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== ""),
  );
}

export const saveCustomer = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "customers.manage");
  const input = parseInput(saveCustomerInput, request.data);
  const customer = input.customerId
    ? db.doc(`customers/${input.customerId}`)
    : db.collection("customers").doc();
  const counter = db.doc(`customerCounters/${actor.organizationId}`);
  const operation = db.doc(
    `idempotencyKeys/${actor.organizationId}_saveCustomer_${input.idempotencyKey}`,
  );
  const cid = correlationId();
  let result = { customerId: customer.id, customerNumber: "", saved: true };
  await db.runTransaction(async (transaction) => {
    const [current, counterSnapshot, previousOperation] = await transaction.getAll(
      customer,
      counter,
      operation,
    );
    if (previousOperation!.exists) {
      result = {
        customerId: String(previousOperation!.get("entityId")),
        customerNumber: String(previousOperation!.get("customerNumber")),
        saved: false,
      };
      return;
    }
    if (
      input.customerId &&
      (!current!.exists || current!.get("organizationId") !== actor.organizationId)
    )
      throw new HttpsError("not-found", "Customer not found.");
    if (
      current!.exists &&
      !input.active &&
      Number(current!.get("outstandingBalanceMinor") ?? 0) > 0
    )
      throw new HttpsError(
        "failed-precondition",
        "Settle the outstanding credit balance before deactivating this customer.",
      );
    const now = FieldValue.serverTimestamp();
    let customerNumber = String(current!.get("customerNumber") ?? "");
    if (!current!.exists) {
      const sequence = Number(counterSnapshot!.get("value") ?? 0) + 1;
      customerNumber = `CUS-${String(sequence).padStart(6, "0")}`;
      transaction.set(counter, {
        organizationId: actor.organizationId,
        kind: "customer",
        value: sequence,
        updatedAt: now,
      });
    }
    const mutable = clean({
      name: input.name,
      normalizedName: input.name.toLowerCase(),
      phone: input.phone,
      email: input.email?.toLowerCase(),
      address: input.address,
      taxId: input.taxId,
      active: input.active,
      updatedAt: now,
      updatedBy: actor.userId,
    });
    if (current!.exists) transaction.update(customer, mutable);
    else
      transaction.create(customer, {
        organizationId: actor.organizationId,
        customerNumber,
        ...mutable,
        creditStatus: "pending",
        creditLimitMinor: 0,
        outstandingBalanceMinor: 0,
        availableCreditMinor: 0,
        createdAt: now,
        createdBy: actor.userId,
      });
    transaction.create(operation, {
      organizationId: actor.organizationId,
      action: "saveCustomer",
      entityId: customer.id,
      customerNumber,
      status: "completed",
      createdAt: now,
      createdBy: actor.userId,
    });
    writeAuditLog(transaction, actor, {
      action: `customer.${current!.exists ? "updated" : "created"}`,
      entityType: "customer",
      entityId: customer.id,
      correlationId: cid,
      sourceFunction: "saveCustomer",
      before: current!.exists
        ? { name: current!.get("name"), active: current!.get("active") }
        : undefined,
      after: { name: input.name, active: input.active, customerNumber },
    });
    result = { customerId: customer.id, customerNumber, saved: true };
  });
  return result;
});

export const decideCustomerCredit = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "customers.credit.approve");
    if (!hasRole(actor, "system_administrator"))
      throw new HttpsError(
        "permission-denied",
        "Only a system administrator may approve customer credit.",
      );
    const input = parseInput(decideCustomerCreditInput, request.data);
    const customer = db.doc(`customers/${input.customerId}`);
    const operation = db.doc(
      `idempotencyKeys/${actor.organizationId}_decideCustomerCredit_${input.idempotencyKey}`,
    );
    const cid = correlationId();
    await db.runTransaction(async (transaction) => {
      const [current, previousOperation] = await transaction.getAll(customer, operation);
      if (previousOperation!.exists) return;
      if (!current!.exists || current!.get("organizationId") !== actor.organizationId)
        throw new HttpsError("not-found", "Customer not found.");
      if (current!.get("active") !== true && input.decision === "approve")
        throw new HttpsError("failed-precondition", "Activate the customer before approving credit.");
      const outstanding = Number(current!.get("outstandingBalanceMinor") ?? 0);
      const limit = input.decision === "approve" ? input.creditLimitMinor : 0;
      if (input.decision === "approve" && limit <= 0)
        throw new HttpsError("invalid-argument", "Approved credit requires a positive limit.");
      if (input.decision === "approve" && limit < outstanding)
        throw new HttpsError(
          "failed-precondition",
          "The credit limit cannot be below the outstanding balance.",
        );
      const status = input.decision === "approve" ? "approved" : input.decision === "suspend" ? "suspended" : "rejected";
      const now = FieldValue.serverTimestamp();
      transaction.update(customer, {
        creditStatus: status,
        creditLimitMinor: limit,
        availableCreditMinor: Math.max(0, limit - outstanding),
        creditDecisionReason: input.reason,
        creditDecidedAt: now,
        creditDecidedBy: actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "decideCustomerCredit",
        entityId: customer.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: `customer.credit_${status}`,
        entityType: "customer",
        entityId: customer.id,
        reason: input.reason,
        correlationId: cid,
        sourceFunction: "decideCustomerCredit",
        before: {
          creditStatus: current!.get("creditStatus"),
          creditLimitMinor: current!.get("creditLimitMinor"),
        },
        after: { creditStatus: status, creditLimitMinor: limit },
      });
    });
    return { customerId: input.customerId, decision: input.decision, saved: true };
  },
);

export const recordCustomerPayment = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "customers.payment.record");
    const input = parseInput(customerPaymentInput, request.data);
    requireBranchScope(actor, input.branchId);
    const customer = db.doc(`customers/${input.customerId}`);
    const branch = db.doc(`branches/${input.branchId}`);
    const counter = db.doc(`customerPaymentCounters/${actor.organizationId}`);
    const journalCounter = db.doc(
      `journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`,
    );
    const payment = db.collection("customerPayments").doc();
    const journal = db.collection("journalEntries").doc();
    const operation = db.doc(
      `idempotencyKeys/${actor.organizationId}_recordCustomerPayment_${input.idempotencyKey}`,
    );
    const effectiveAt = Timestamp.now();
    const accountingPeriod = accountingPeriodReference(actor.organizationId, effectiveAt);
    const cid = correlationId();
    let result = { paymentId: payment.id, paymentNumber: "", recorded: true };
    await db.runTransaction(async (transaction) => {
      const [current, branchSnapshot, counterSnapshot, journalCounterSnapshot, accountingPeriodSnapshot, previousOperation] =
        await transaction.getAll(customer, branch, counter, journalCounter, accountingPeriod, operation);
      if (previousOperation!.exists) {
        result = {
          paymentId: String(previousOperation!.get("entityId")),
          paymentNumber: String(previousOperation!.get("paymentNumber")),
          recorded: false,
        };
        return;
      }
      assertAccountingPeriodOpen(accountingPeriodSnapshot!);
      if (!current!.exists || current!.get("organizationId") !== actor.organizationId)
        throw new HttpsError("not-found", "Customer not found.");
      if (
        !branchSnapshot!.exists ||
        branchSnapshot!.get("organizationId") !== actor.organizationId ||
        branchSnapshot!.get("status") !== "active"
      )
        throw new HttpsError("failed-precondition", "Branch is unavailable.");
      const outstanding = Number(current!.get("outstandingBalanceMinor") ?? 0);
      if (input.amountMinor > outstanding)
        throw new HttpsError(
          "invalid-argument",
          "The payment cannot exceed the customer's outstanding balance.",
        );
      const paymentSequence = Number(counterSnapshot!.get("value") ?? 0) + 1;
      const journalSequence = Number(journalCounterSnapshot!.get("value") ?? 0) + 1;
      const year = new Date().getUTCFullYear();
      const paymentNumber = `CRP-${year}-${String(paymentSequence).padStart(6, "0")}`;
      const journalNumber = `JRN-${year}-${String(journalSequence).padStart(6, "0")}`;
      const nextOutstanding = outstanding - input.amountMinor;
      const creditLimit = Number(current!.get("creditLimitMinor") ?? 0);
      const account = paymentAccount[input.method]!;
      const journalLines = [
        { accountCode: account.code, accountName: account.name, debitMinor: input.amountMinor, creditMinor: 0 },
        { accountCode: "1100", accountName: "Accounts receivable", debitMinor: 0, creditMinor: input.amountMinor },
      ];
      assertBalancedJournal(journalLines);
      const now = FieldValue.serverTimestamp();
      transaction.update(customer, {
        outstandingBalanceMinor: nextOutstanding,
        availableCreditMinor:
          current!.get("creditStatus") === "approved"
            ? Math.max(0, creditLimit - nextOutstanding)
            : 0,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.set(counter, {
        organizationId: actor.organizationId,
        kind: "customerPayment",
        value: paymentSequence,
        updatedAt: now,
      });
      transaction.set(journalCounter, {
        organizationId: actor.organizationId,
        kind: "journalEntry",
        value: journalSequence,
        updatedAt: now,
      });
      transaction.create(payment, clean({
        organizationId: actor.organizationId,
        branchId: input.branchId,
        customerId: customer.id,
        customerNumber: current!.get("customerNumber"),
        customerName: current!.get("name"),
        paymentNumber,
        method: input.method,
        amountMinor: input.amountMinor,
        reference: input.reference,
        notes: input.notes,
        currency: "NGN",
        status: "recorded",
        recordedAt: now,
        recordedBy: actor.userId,
        createdAt: now,
      }));
      transaction.create(db.collection("customerAccountEntries").doc(), {
        organizationId: actor.organizationId,
        branchId: input.branchId,
        customerId: customer.id,
        entryType: "payment",
        referenceType: "customerPayment",
        referenceId: payment.id,
        referenceNumber: paymentNumber,
        amountMinor: -input.amountMinor,
        balanceAfterMinor: nextOutstanding,
        currency: "NGN",
        effectiveAt,
        createdAt: now,
        createdBy: actor.userId,
      });
      transaction.create(journal, {
        organizationId: actor.organizationId,
        branchId: input.branchId,
        journalNumber,
        journalType: "customer_payment",
        status: "posted",
        referenceType: "customerPayment",
        referenceId: payment.id,
        referenceNumber: paymentNumber,
        description: `Customer payment ${paymentNumber}`,
        totalDebitMinor: input.amountMinor,
        totalCreditMinor: input.amountMinor,
        currency: "NGN",
        effectiveAt,
        postedAt: now,
        postedBy: actor.userId,
        correlationId: cid,
        createdAt: now,
      });
      for (const line of journalLines) {
        const chartAccount = db.doc(
          `chartOfAccounts/${uniquenessDocumentId(actor.organizationId, line.accountCode)}`,
        );
        transaction.set(chartAccount, {
          organizationId: actor.organizationId,
          code: line.accountCode,
          name: line.accountName,
          currency: "NGN",
          active: true,
          systemManaged: true,
          updatedAt: now,
        }, { merge: true });
        transaction.create(db.collection("journalLines").doc(), {
          organizationId: actor.organizationId,
          branchId: input.branchId,
          journalEntryId: journal.id,
          journalNumber,
          accountId: chartAccount.id,
          accountCode: line.accountCode,
          accountName: line.accountName,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
          currency: "NGN",
          effectiveAt,
          createdAt: now,
        });
      }
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "recordCustomerPayment",
        entityId: payment.id,
        paymentNumber,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: "customer.payment_recorded",
        entityType: "customerPayment",
        entityId: payment.id,
        correlationId: cid,
        sourceFunction: "recordCustomerPayment",
        after: {
          customerId: customer.id,
          paymentNumber,
          amountMinor: input.amountMinor,
          balanceAfterMinor: nextOutstanding,
        },
      });
      result = { paymentId: payment.id, paymentNumber, recorded: true };
    });
    return result;
  },
);
