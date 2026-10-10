import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import ts from "typescript";

export function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => entry.isDirectory()
    ? sourceFiles(join(directory, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(directory, entry.name)] : []);
}
const literal = (node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
const method = (node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null;
const queryMethods = new Set(["collection", "collectionGroup", "where", "orderBy", "aggregate", "count", "query", "startAt", "endAt", "startAfter", "useOrganizationCollection"]);

/** Changing any query-bearing source requires an explicit review of this catalog. */
export function querySourceFingerprints() {
  const fingerprints = {};
  for (const file of [...sourceFiles("functions/src"), ...sourceFiles("src")].sort()) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const calls = [];
    function visit(node) {
      if (ts.isCallExpression(node) && queryMethods.has(method(node) ?? (ts.isIdentifier(node.expression) ? node.expression.text : ""))) calls.push(node.getText(source));
      ts.forEachChild(node, visit);
    }
    visit(source);
    // Hash the complete source: dynamic field maps and scope conditions can
    // change a query without changing its orderBy(field)/where(variable) call.
    if (calls.length) fingerprints[file] = createHash("sha256").update(source.text).digest("hex");
  }
  return fingerprints;
}

export function subsets(fields) {
  return Array.from({ length: 2 ** fields.length }, (_, mask) => fields.filter((_, bit) => mask & (1 << bit)));
}

/** Planner-only values: no customer/employee records are read and no mutations occur. */
export function queryCatalog() {
  const shapes = new Map();
  function add(source, collection, filters = [], order = [], sums = null, parent = null) {
    const shape = { collection, filters, order, sums, parent };
    const key = JSON.stringify(shape);
    if (!shapes.has(key)) shapes.set(key, { ...shape, sources: [] });
    if (!shapes.get(key).sources.includes(source)) shapes.get(key).sources.push(source);
  }
  const eq = (fields) => fields.map((field) => [field, "=="]);
  const org = ["organizationId", "=="];
  const scopes = [[], [["branchId", "in"]], [["warehouseId", "in"]]];
  const dateOrder = (field, direction = "DESCENDING") => [[field, direction], ["__name__", direction]];
  add("stock count posting variance pages", "stockCountItems", [["stockCountId", "=="], ["variance", "!="]], [["variance", "ASCENDING"], ["__name__", "ASCENDING"]]);
  add("stock count workspace pages", "stockCountItems", [["stockCountId", "=="]], [["__name__", "ASCENDING"]]);
  add("stock count incomplete submission guard", "stockCountItems", [["stockCountId", "=="], ["countedQuantity", "=="]]);

  // Extract direct literal collection chains, including jobs and transactional lookups.
  function chain(node) {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
    const name = method(node), args = node.arguments;
    if (name === "collection" && literal(args[0])) return { collection: literal(args[0]), filters: [], order: [] };
    const previous = chain(node.expression.expression);
    if (!previous || name === "doc" || name === "collectionGroup") return null;
    if (name === "where") {
      if (!literal(args[0]) || !literal(args[1])) return null; // Dynamic builders are expanded below.
      previous.filters.push([literal(args[0]), literal(args[1])]);
    }
    if (name === "orderBy") {
      const field = literal(args[0]) ?? (args[0]?.getText().includes("documentId()") ? "__name__" : null);
      if (!field) return null;
      previous.order.push([field, literal(args[1]) === "desc" ? "DESCENDING" : "ASCENDING"]);
    }
    return previous;
  }
  for (const file of [...sourceFiles("functions/src"), ...sourceFiles("src")]) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useOrganizationCollection" && literal(node.arguments[0])) add(file, literal(node.arguments[0]), [["organizationId", "=="]]);
      if (ts.isCallExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
        const shape = chain(node);
        if (shape) add(file, shape.collection, shape.filters, shape.order);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }

  for (const scope of scopes) {
    for (const optional of subsets(["productId", "locationId", "transactionType", "serialNumber"])) {
      add("inventory history/movement filters", "inventoryEntries", [org, ...scope, ...eq(optional), ["effectiveAt", ">="], ["effectiveAt", "<="]], dateOrder("effectiveAt"));
    }
    for (const optional of subsets(["productId", "locationId"])) {
      const filters = [org, ...scope, ...eq(optional)];
      add("inventory stock/valuation rows", "inventoryBalances", filters, [["__name__", "ASCENDING"]]);
      add("inventory stock/valuation totals", "inventoryBalances", filters, [], ["onHandQuantity", "reservedQuantity", "availableQuantity", "totalValueMinor"]);
      add("serial register", "serializedItems", filters.map(([field, op]) => [field === "locationId" ? "currentLocationId" : field, op]), [["__name__", "ASCENDING"]]);
      add("stock adjustments", "inventoryEntries", [...filters, ["transactionType", "=="]], [["__name__", "ASCENDING"]]);
      add("stock variance report", "stockCountItems", [...filters, ["variance", "!="]], [["variance", "ASCENDING"], ["__name__", "ASCENDING"]]);
    }
    for (const collection of ["inventoryBalances", "serializedItems"]) add("product details scoped stock", collection, [org, ...scope, ["productId", "=="]]);
  }
  for (const scope of [[], [["branchId", "=="]], [["branchId", "in"]]]) {
    for (const optional of subsets(["status", "priority", "requestType"])) {
      add("request list/report filters", "branchRequests", [org, ...scope, ...eq(optional), ["createdAt", ">="], ["createdAt", "<="]], dateOrder("createdAt"));
    }
    for (const optional of subsets(["productId"])) add("request item/demand report", "branchRequestItems", [org, ...scope, ...eq(optional)], [["__name__", "ASCENDING"]]);
  }
  for (const optional of subsets(["originWarehouseId", "destinationBranchId", "status", "sourceType"])) add("transfer register filters", "transfers", [org, ...eq(optional)], [["__name__", "ASCENDING"]]);
  for (const field of ["originWarehouseId", "destinationBranchId"]) for (const optional of subsets(["status", "sourceType"])) add("assigned transfer register", "transfers", [org, [field, "in"], ...eq(optional)], [["__name__", "ASCENDING"]]);
  for (const collection of ["purchaseOrders", "purchaseOrderItems", "supplierInvoices", "expenses"]) for (const scope of subsets(["branchId", "warehouseId"])) add("procurement/expense workspace", collection, [org, ...eq(scope)]);
  add("purchase receipt history", "purchaseReceipts", [org, ["purchaseOrderId", "=="]], dateOrder("receivedAt"));
  add("supplier return original receipts", "purchaseReceipts", [org, ["purchaseOrderItemId", "=="]], dateOrder("receivedAt"));
  add("supplier return history", "supplierReturns", [org, ["supplierInvoiceId", "=="]], dateOrder("createdAt"));
  add("supplier return invoice products", "supplierInvoiceItems", [org, ["supplierInvoiceId", "=="]]);
  add("supplier return receipt ledger", "inventoryEntries", [["transactionId", "=="], ["locationId", "=="]]);
  add("customer returns cursor pages", "saleReturns", [org, ...eq(["branchId", "status"])]);
  add("customer return inspection items", "saleReturnItems", [["returnId", "=="]]);
  add("purchase receipt stock evidence", "inventoryEntries", [org, ["transactionId", "=="], ["locationId", "=="]]);
  for (const scope of [[], ["branchId"], ["warehouseId"]]) {
    const filters = [org, ["supplierId", "=="], ...eq(scope)];
    const unpaid = [...filters, ["status", "in"]];
    add("supplier unpaid invoice pages", "supplierInvoices", unpaid, [["__name__", "ASCENDING"]]);
    add("supplier unpaid totals", "supplierInvoices", unpaid, [], ["outstandingAmountMinor"]);
    add("supplier payable aging", "supplierInvoices", [...unpaid, ["dueDate", ">="], ["dueDate", "<="]], [], ["outstandingAmountMinor"]);
    for (const range of [[], [["effectiveAt", ">="]], [["effectiveAt", "<="]], [["effectiveAt", ">="], ["effectiveAt", "<="]]]) {
      add("supplier statement pages", "supplierAccountEntries", [...filters, ...range], dateOrder("effectiveAt"));
      for (const field of ["amountMinor", "advanceAmountMinor"]) add("supplier statement separate totals", "supplierAccountEntries", [...filters, ...range], [], [field]);
    }
    for (const field of ["amountMinor", "advanceAmountMinor"]) add("supplier statement opening balance", "supplierAccountEntries", [...filters, ["effectiveAt", "<"]], [], [field]);
  }
  for (const scope of [[], ["branchId"]]) {
    const filters = [org, ...eq(scope)];
    add("aftersales workspace", "aftersalesCases", filters);
    for (const [collection, date] of [["sales", "recordedAt"], ["saleReturns", "createdAt"], ["customerAccountEntries", "effectiveAt"]]) add("customer history", collection, [...filters, ["customerId", "=="]], [[date, "DESCENDING"]]);
    add("financial statements/tax", "journalLines", [...filters, ["effectiveAt", ">="], ["effectiveAt", "<="]], dateOrder("effectiveAt", "ASCENDING"));
    add("financial cumulative balances", "journalLines", [...filters, ["effectiveAt", "<="]], dateOrder("effectiveAt", "ASCENDING"));
    for (const range of [[], [["effectiveAt", ">="]], [["effectiveAt", "<"]], [["effectiveAt", ">="], ["effectiveAt", "<"]]])
      add("customer statement rows and balances", "customerAccountEntries", [...filters, ["customerId", "=="], ...range], dateOrder("effectiveAt"));
    for (const range of [[], [["recordedAt", ">="]], [["recordedAt", "<"]], [["recordedAt", ">="], ["recordedAt", "<"]]])
      add("credit sales summary scan", "sales", [...filters, ...range], dateOrder("recordedAt", "ASCENDING"));
    for (const range of [[], [["recordedAt", ">="], ["recordedAt", "<"]]]) {
      add("sales report rows", "sales", [...filters, ...range], dateOrder("recordedAt"));
      for (const sums of [["subtotalAmountMinor", "discountAmountMinor", "netAmountMinor", "vatAmountMinor"], ["grossAmountMinor", "amountPaidMinor", "creditAmountMinor"], []]) add("sales report/dashboard totals", "sales", [...filters, ...range], [], sums);
      for (const op of ["==", "in"]) add("dashboard payment mix", "sales", [...filters, ...range, ["paymentStatus", op]], [], []);
    }
    for (const collection of ["transfers", "stockTransfers"]) for (const transferScope of scope.length ? ["sourceBranchId", "destinationBranchId"] : [null]) for (const status of [[], [["status", "in"]]]) add("dashboard transfer counts (OR arms)", collection, [org, ...(transferScope ? [[transferScope, "=="]] : []), ...status], [], []);
    for (const status of [[], [["status", "in"]]]) add("dashboard request counts", "branchRequests", [...filters, ...status], [], []);
  }
  add("service receipt/refund history pages", "aftersalesPayments", [org, ["caseId", "=="]], dateOrder("recordedAt"));
  for (const field of ["sourceWarehouseId", "originWarehouseId"]) for (const status of [[], [["status", "in"]]]) add("legacy location dashboard", field === "sourceWarehouseId" ? "stockTransfers" : "transfers", [org, [field, "=="], ...status], [], []);
  add("dashboard active products", "products", [org, ["active", "=="]], [], []);
  for (const field of ["customerNumber", "normalizedName", "phone", "email"]) add("customer register/search", "customers", [org], [[field, "ASCENDING"]]);
  for (const scope of [[], [["branchId", "=="]]]) {
    const filters = [org, ...eq(["customerId", "receivableStatus"]), ...scope];
    add("customer unpaid invoice pages", "sales", filters, dateOrder("receivableDueDate", "ASCENDING"));
    add("customer receivable aging", "sales", [...filters, ["receivableDueDate", ">="], ["receivableDueDate", "<="]], [], ["receivableOutstandingMinor"]);
  }
  add("notification inbox/clear all", "notifications", [org], [["occurredAt", "DESCENDING"]], null, "users/index-audit-probe");
  for (const collection of ["branches", "users", "products", "suppliers", "inventoryLocations", "auditLogs", "roles", "bankAccounts", "taxRules", "journalEntries", "journalLines"]) add("organization-scoped client registers", collection, [org]);
  add("daily close cash evidence", "journalLines", eq(["organizationId", "branchId", "accountCode"]), [["__name__", "ASCENDING"]]);
  add("monthly budget register", "budgets", eq(["organizationId", "month", "scopeKey"]), [["__name__", "ASCENDING"]]);
  add("monthly budget revision history", "budgetRevisions", eq(["organizationId", "budgetId"]), [["__name__", "ASCENDING"]]);
  for (const scope of [[], [["branchId", "=="]]]) add("paged accounting journal register", "journalEntries", [org, ...scope, ["effectiveAt", ">="], ["effectiveAt", "<="]], dateOrder("effectiveAt"));
  add("daily close stock evidence", "stockCounts", eq(["organizationId", "branchId", "countDate"]), [["__name__", "ASCENDING"]]);
  add("daily close till evidence", "posShifts", eq(["organizationId", "branchId"]), [["__name__", "ASCENDING"]]);
  for (const [collection, field, endOperator] of [["attendanceEvents", "occurredAt", "<"], ["employeeActivityEvents", "occurredOn", "<="]])
    add("HR date-range history", collection, [org, [field, ">="], [field, endOperator]], dateOrder(field));
  for (const scope of [[], [["branchId", "=="]]]) {
    add("multi-month budget ledger actuals", "journalLines", [org, ...scope, ["effectiveAt", ">="], ["effectiveAt", "<"]], dateOrder("effectiveAt", "ASCENDING"));
    add("product invoice-cohort margin scan", "sales", [org, ...scope, ["recordedAt", ">="], ["recordedAt", "<"]], dateOrder("recordedAt", "ASCENDING"));
  }
  return [...shapes.values()];
}
