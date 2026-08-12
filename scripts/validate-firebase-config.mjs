import { readFileSync } from "node:fs";
for (const file of ["firebase.json", "firestore.indexes.json"]) JSON.parse(readFileSync(file, "utf8"));
const config = JSON.parse(readFileSync("firebase.json", "utf8"));
if (config.firestore?.rules !== "firestore.rules" || config.firestore?.indexes !== "firestore.indexes.json") throw new Error("Firestore rules/index configuration is incomplete.");
if (config.storage?.rules !== "storage.rules") throw new Error("Storage rules are not declared.");
console.log("Firebase and Firestore index JSON validation passed.");
