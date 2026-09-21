import { Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { requireAccess, requirePermission } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { parseInput } from "../utils/callable.js";
import {
  financialReportInput,
  taxWorkspaceInput,
} from "../validation/financial-reports.js";

interface LedgerTotal {
  accountCode: string;
  accountName: string;
  debitMinor: number;
  creditMinor: number;
}

function startTimestamp(date: string) {
  return Timestamp.fromDate(new Date(`${date}T00:00:00.000Z`));
}
function endTimestamp(date: string) {
  return Timestamp.fromDate(new Date(`${date}T23:59:59.999Z`));
}
function aggregateLines(lines: FirebaseFirestore.QueryDocumentSnapshot[]) {
  const totals = new Map<string, LedgerTotal>();
  for (const line of lines) {
    const accountCode = String(line.get("accountCode") ?? "UNKNOWN");
    const current = totals.get(accountCode) ?? {
      accountCode,
      accountName: String(line.get("accountName") ?? accountCode),
      debitMinor: 0,
      creditMinor: 0,
    };
    current.debitMinor += Number(line.get("debitMinor") ?? 0);
    current.creditMinor += Number(line.get("creditMinor") ?? 0);
    totals.set(accountCode, current);
  }
  return [...totals.values()].sort((left, right) =>
    left.accountCode.localeCompare(right.accountCode),
  );
}
function sectionForBalanceSheet(code: string) {
  if (code.startsWith("1")) return "Assets";
  if (code.startsWith("2")) return "Liabilities";
  if (code.startsWith("3")) return "Equity";
  return null;
}
function sectionForIncome(code: string) {
  if (code.startsWith("4")) return "Income";
  if (/^[5-9]/.test(code)) return "Expenses";
  return null;
}

export const generateFinancialStatement = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "finance.journal.read");
    const input = parseInput(financialReportInput, request.data);
    let query: FirebaseFirestore.Query = db
      .collection("journalLines")
      .where("organizationId", "==", actor.organizationId)
      .where("effectiveAt", "<=", endTimestamp(input.toDate));
    if (input.reportType !== "balance_sheet" && input.reportType !== "trial_balance")
      query = query.where("effectiveAt", ">=", startTimestamp(input.fromDate));
    const lines = await query.limit(10_001).get();
    if (lines.size > 10_000)
      throw new HttpsError(
        "resource-exhausted",
        "This statement exceeds 10,000 ledger lines. Select a shorter period.",
      );
    const totals = aggregateLines(lines.docs);

    if (input.reportType === "trial_balance") {
      const rows = totals.map((line) => ({
        ...line,
        balanceMinor: line.debitMinor - line.creditMinor,
      }));
      return {
        ...input,
        rows,
        totalDebitMinor: rows.reduce((sum, row) => sum + row.debitMinor, 0),
        totalCreditMinor: rows.reduce((sum, row) => sum + row.creditMinor, 0),
      };
    }

    if (input.reportType === "income_statement") {
      const rows = totals.flatMap((line) => {
        const section = sectionForIncome(line.accountCode);
        if (!section) return [];
        return [{
          section,
          accountCode: line.accountCode,
          accountName: line.accountName,
          amountMinor:
            section === "Income"
              ? line.creditMinor - line.debitMinor
              : line.debitMinor - line.creditMinor,
        }];
      });
      const incomeMinor = rows
        .filter((row) => row.section === "Income")
        .reduce((sum, row) => sum + row.amountMinor, 0);
      const expenseMinor = rows
        .filter((row) => row.section === "Expenses")
        .reduce((sum, row) => sum + row.amountMinor, 0);
      return { ...input, rows, incomeMinor, expenseMinor, profitMinor: incomeMinor - expenseMinor };
    }

    if (input.reportType === "balance_sheet") {
      const rows = totals.flatMap((line) => {
        const section = sectionForBalanceSheet(line.accountCode);
        if (!section) return [];
        return [{
          section,
          accountCode: line.accountCode,
          accountName: line.accountName,
          amountMinor:
            section === "Assets"
              ? line.debitMinor - line.creditMinor
              : line.creditMinor - line.debitMinor,
        }];
      });
      const retainedEarningsMinor = totals.reduce((sum, line) => {
        const section = sectionForIncome(line.accountCode);
        if (section === "Income")
          return sum + line.creditMinor - line.debitMinor;
        if (section === "Expenses")
          return sum - line.debitMinor + line.creditMinor;
        return sum;
      }, 0);
      rows.push({
        section: "Equity",
        accountCode: "3999",
        accountName: "Cumulative earnings (unclosed)",
        amountMinor: retainedEarningsMinor,
      });
      const sectionTotal = (section: string) => rows
        .filter((row) => row.section === section)
        .reduce((sum, row) => sum + row.amountMinor, 0);
      return {
        ...input,
        rows,
        assetsMinor: sectionTotal("Assets"),
        liabilitiesMinor: sectionTotal("Liabilities"),
        equityMinor: sectionTotal("Equity"),
        balanced: sectionTotal("Assets") === sectionTotal("Liabilities") + sectionTotal("Equity"),
      };
    }

    const entryIds = [...new Set(lines.docs.map((line) => String(line.get("journalEntryId"))))];
    const entrySnapshots = await Promise.all(
      entryIds.slice(0, 1_000).map((id) => db.doc(`journalEntries/${id}`).get()),
    );
    if (entryIds.length > 1_000)
      throw new HttpsError(
        "resource-exhausted",
        "This cash-flow statement exceeds 1,000 journals. Select a shorter period.",
      );
    const typeByEntry = new Map(
      entrySnapshots.map((entry) => [entry.id, String(entry.get("journalType") ?? "other")]),
    );
    const bankCodes = new Set(
      (await db.collection("bankAccounts")
        .where("organizationId", "==", actor.organizationId)
        .limit(100)
        .get()).docs.map((account) => String(account.get("ledgerAccountCode"))),
    );
    bankCodes.add("1010");
    bankCodes.add("1020");
    bankCodes.add("1030");
    const investingTypes = new Set(["asset_purchase", "asset_disposal"]);
    const financingTypes = new Set(["capital_contribution", "loan_receipt", "loan_repayment", "dividend"]);
    const grouped = new Map<string, number>([
      ["Operating activities", 0],
      ["Investing activities", 0],
      ["Financing activities", 0],
    ]);
    for (const line of lines.docs) {
      if (!bankCodes.has(String(line.get("accountCode")))) continue;
      const journalType = typeByEntry.get(String(line.get("journalEntryId"))) ?? "other";
      const section = investingTypes.has(journalType)
        ? "Investing activities"
        : financingTypes.has(journalType)
          ? "Financing activities"
          : "Operating activities";
      grouped.set(
        section,
        (grouped.get(section) ?? 0) +
          Number(line.get("debitMinor") ?? 0) -
          Number(line.get("creditMinor") ?? 0),
      );
    }
    const rows = [...grouped].map(([section, amountMinor]) => ({ section, amountMinor }));
    return {
      ...input,
      rows,
      netCashMovementMinor: rows.reduce((sum, row) => sum + row.amountMinor, 0),
    };
  },
);

export const getTaxWorkspace = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "finance.journal.read");
    const input = parseInput(taxWorkspaceInput, request.data);
    const [lines, rules] = await Promise.all([
      db.collection("journalLines")
        .where("organizationId", "==", actor.organizationId)
        .where("effectiveAt", ">=", startTimestamp(input.fromDate))
        .where("effectiveAt", "<=", endTimestamp(input.toDate))
        .limit(10_001)
        .get(),
      db.collection("taxRules")
        .where("organizationId", "==", actor.organizationId)
        .limit(100)
        .get(),
    ]);
    if (lines.size > 10_000)
      throw new HttpsError("resource-exhausted", "Select a shorter tax period.");
    const outputVatMinor = lines.docs
      .filter((line) => line.get("accountCode") === "2100")
      .reduce((sum, line) => sum + Number(line.get("creditMinor") ?? 0) - Number(line.get("debitMinor") ?? 0), 0);
    const inputVatMinor = lines.docs
      .filter((line) => line.get("accountCode") === "1300")
      .reduce((sum, line) => sum + Number(line.get("debitMinor") ?? 0) - Number(line.get("creditMinor") ?? 0), 0);
    return {
      ...input,
      vat: {
        taxType: "VAT",
        outputVatMinor,
        inputVatMinor,
        calculatedLiabilityMinor: outputVatMinor - inputVatMinor,
        status: "calculated",
      },
      rules: rules.docs.map((rule) => ({ id: rule.id, ...rule.data() })),
      statutoryRuleReviewRequired: !rules.docs.some((rule) =>
        String(rule.get("taxType") ?? "").toUpperCase() === "VAT" &&
        ["approved", "active"].includes(String(rule.get("status"))) &&
        Boolean(rule.get("effectiveFrom")) &&
        String(rule.get("effectiveFrom") ?? "") <= input.toDate &&
        (!rule.get("effectiveTo") || String(rule.get("effectiveTo")) >= input.fromDate) &&
        Boolean(rule.get("source"))),
    };
  },
);
