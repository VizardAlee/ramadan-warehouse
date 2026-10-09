import { Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { hasServerPermission, requireAccess, requireBranchScope, requirePermission } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { parseInput } from "../utils/callable.js";
import { visitQueryPages } from "../utils/query-pages.js";
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
function aggregateLines(lines: FirebaseFirestore.QueryDocumentSnapshot[], totals: Map<string, LedgerTotal>) {
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
    if (!Number.isSafeInteger(current.debitMinor) || !Number.isSafeInteger(current.creditMinor))
      throw new HttpsError("failed-precondition", "The ledger contains amounts outside safe minor-unit arithmetic. Reconcile the affected account before issuing this statement.");
    totals.set(accountCode, current);
  }
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
  { enforceAppCheck, timeoutSeconds: 300 },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "finance.journal.read");
    const input = parseInput(financialReportInput, request.data);
    const canReadOrganization = hasServerPermission(actor, "sales.read.all");
    const branchId = input.branchId ?? (!canReadOrganization && actor.branchIds.length === 1 ? actor.branchIds[0] : undefined);
    if (!canReadOrganization && !branchId)
      throw new HttpsError("invalid-argument", "Select one assigned store for this statement.");
    if (branchId) requireBranchScope(actor, branchId);
    let query: FirebaseFirestore.Query = db
      .collection("journalLines")
      .where("organizationId", "==", actor.organizationId)
      .where("effectiveAt", "<=", endTimestamp(input.toDate));
    if (branchId) query = query.where("branchId", "==", branchId);
    if (input.reportType !== "balance_sheet" && input.reportType !== "trial_balance")
      query = query.where("effectiveAt", ">=", startTimestamp(input.fromDate));
    const ledgerTotals = new Map<string, LedgerTotal>();
    const bankCodes = new Set(["1010", "1020", "1030"]);
    const grouped = new Map<string, number>([["Operating activities", 0], ["Investing activities", 0], ["Financing activities", 0]]);
    const investingTypes = new Set(["asset_purchase", "asset_disposal"]);
    const financingTypes = new Set(["capital_contribution", "loan_receipt", "loan_repayment", "dividend"]);
    if (input.reportType === "cash_flow")
      await visitQueryPages(db.collection("bankAccounts").where("organizationId", "==", actor.organizationId), (accounts) => {
        for (const account of accounts) if (account.get("ledgerAccountCode")) bankCodes.add(String(account.get("ledgerAccountCode")));
      });
    await visitQueryPages(query, async (lines) => {
      aggregateLines(lines, ledgerTotals);
      if (input.reportType !== "cash_flow") return;
      const cashLines = lines.filter((line) => bankCodes.has(String(line.get("accountCode"))));
      const entryIds = [...new Set(cashLines.map((line) => String(line.get("journalEntryId"))))];
      const typeByEntry = new Map<string, string>();
      const activityByEntry = new Map<string, string>();
      for (let offset = 0; offset < entryIds.length; offset += 100) {
        const snapshots = await db.getAll(...entryIds.slice(offset, offset + 100).map((id) => db.doc(`journalEntries/${id}`)));
        for (const entry of snapshots) {
          if (!entry.exists || entry.get("organizationId") !== actor.organizationId || (branchId && entry.get("branchId") !== branchId))
            throw new HttpsError("failed-precondition", "A cash ledger entry has no matching journal in this reporting scope. Reconcile the journal before issuing this statement.");
          typeByEntry.set(entry.id, String(entry.get("journalType") ?? "other"));
          const activity = entry.get("cashFlowActivity");
          if (activity !== undefined && !["operating", "investing", "financing"].includes(activity))
            throw new HttpsError("failed-precondition", "A journal cash-flow classification requires review.");
          if (activity) activityByEntry.set(entry.id, activity);
        }
      }
      for (const line of cashLines) {
        const journalType = typeByEntry.get(String(line.get("journalEntryId")))!;
        const activity = activityByEntry.get(String(line.get("journalEntryId")));
        const section = activity ? ({ operating: "Operating activities", investing: "Investing activities", financing: "Financing activities" } as Record<string, string>)[activity]!
          : investingTypes.has(journalType) ? "Investing activities" : financingTypes.has(journalType) ? "Financing activities" : "Operating activities";
        grouped.set(section, grouped.get(section)! + Number(line.get("debitMinor") ?? 0) - Number(line.get("creditMinor") ?? 0));
      }
    }, { orderField: "effectiveAt" });
    const totals = [...ledgerTotals.values()].sort((left, right) => left.accountCode.localeCompare(right.accountCode));

    if (input.reportType === "trial_balance") {
      const rows = totals.map((line) => ({
        ...line,
        balanceMinor: line.debitMinor - line.creditMinor,
      }));
      return {
        ...input, branchId: branchId ?? null,
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
      return { ...input, branchId: branchId ?? null, rows, incomeMinor, expenseMinor, profitMinor: incomeMinor - expenseMinor };
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
        ...input, branchId: branchId ?? null,
        rows,
        assetsMinor: sectionTotal("Assets"),
        liabilitiesMinor: sectionTotal("Liabilities"),
        equityMinor: sectionTotal("Equity"),
        netAssetsMinor: sectionTotal("Assets") - sectionTotal("Liabilities"),
        balanced: sectionTotal("Assets") === sectionTotal("Liabilities") + sectionTotal("Equity"),
      };
    }

    const rows = [...grouped].map(([section, amountMinor]) => ({ section, amountMinor }));
    return {
      ...input, branchId: branchId ?? null,
      rows,
      netCashMovementMinor: rows.reduce((sum, row) => sum + row.amountMinor, 0),
    };
  },
);

export const getTaxWorkspace = onCall(
  { enforceAppCheck, timeoutSeconds: 300 },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "finance.journal.read");
    if (!hasServerPermission(actor, "sales.read.all"))
      throw new HttpsError("permission-denied", "The organization Tax Centre requires organization-wide finance access.");
    const input = parseInput(taxWorkspaceInput, request.data);
    const totals = new Map<string, LedgerTotal>();
    const ruleDocuments: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    await Promise.all([
      visitQueryPages(db.collection("journalLines")
        .where("organizationId", "==", actor.organizationId)
        .where("effectiveAt", ">=", startTimestamp(input.fromDate))
        .where("effectiveAt", "<=", endTimestamp(input.toDate)),
        (lines) => aggregateLines(lines, totals), { orderField: "effectiveAt" }),
      visitQueryPages(db.collection("taxRules")
        .where("organizationId", "==", actor.organizationId), (rules) => { ruleDocuments.push(...rules); }),
    ]);
    const outputVat = totals.get("2100");
    const inputVat = totals.get("1300");
    const outputVatMinor = (outputVat?.creditMinor ?? 0) - (outputVat?.debitMinor ?? 0);
    const inputVatMinor = (inputVat?.debitMinor ?? 0) - (inputVat?.creditMinor ?? 0);
    return {
      ...input,
      vat: {
        taxType: "VAT",
        outputVatMinor,
        inputVatMinor,
        calculatedLiabilityMinor: outputVatMinor - inputVatMinor,
        status: "calculated",
      },
      rules: ruleDocuments.map((rule) => ({ id: rule.id, ...rule.data() })),
      statutoryRuleReviewRequired: !ruleDocuments.some((rule) =>
        String(rule.get("taxType") ?? "").toUpperCase() === "VAT" &&
        ["approved", "active"].includes(String(rule.get("status"))) &&
        Boolean(rule.get("effectiveFrom")) &&
        String(rule.get("effectiveFrom") ?? "") <= input.toDate &&
        (!rule.get("effectiveTo") || String(rule.get("effectiveTo")) >= input.fromDate) &&
        Boolean(rule.get("source"))),
    };
  },
);
