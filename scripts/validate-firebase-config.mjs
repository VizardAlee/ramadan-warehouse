import { readFileSync } from "node:fs";
for (const file of ["firebase.json", "firestore.indexes.json"]) JSON.parse(readFileSync(file, "utf8"));
const config = JSON.parse(readFileSync("firebase.json", "utf8"));
if (config.firestore?.rules !== "firestore.rules" || config.firestore?.indexes !== "firestore.indexes.json") throw new Error("Firestore rules/index configuration is incomplete.");
if (config.storage?.rules !== "storage.rules") throw new Error("Storage rules are not declared.");
const { indexes } = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));
const salesReportAggregates = [
  ["discountAmountMinor", "netAmountMinor", "subtotalAmountMinor", "vatAmountMinor"],
  ["amountPaidMinor", "creditAmountMinor", "grossAmountMinor"],
];
for (const scope of [["branchId", "organizationId"], ["organizationId"]]) {
  for (const amounts of salesReportAggregates) {
    const required = [...scope, "recordedAt", ...amounts];
    if (!indexes.some((index) => index.collectionGroup === "sales" &&
      index.queryScope === "COLLECTION" &&
      index.fields.map((field) => field.fieldPath).join(",") === required.join(",") &&
      index.fields.every((field) => field.order === "ASCENDING"))) {
      throw new Error(`Missing sales report aggregate index: ${required.join(", ")}`);
    }
  }
}
console.log("Firebase and Firestore index JSON validation passed.");
