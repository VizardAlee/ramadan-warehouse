import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const target = process.argv[2];
if (!['staging', 'production'].includes(target)) throw new Error("Deployment target must be staging or production.");
const aliases = JSON.parse(readFileSync(".firebaserc", "utf8")).projects ?? {};
if (!aliases[target] || aliases[target].startsWith("demo-") || aliases[target].includes("replace-with")) throw new Error(`A real ${target} Firebase alias is required.`);
if (target === "production" && aliases.production !== "ramadan-warehouse-staging") throw new Error("Production must resolve to the owner-approved immutable Firebase project ID.");
if (target === "production" && aliases.staging) throw new Error("The converted project must not retain an ambiguous staging alias.");
if (target === "staging" && aliases.production === aliases.staging) throw new Error("Staging and production aliases must not resolve to the same project.");
if (aliases.default && aliases.default === aliases[target]) throw new Error("Deployment aliases must not rely on an ambiguous default project.");
if (!existsSync(`.env.${target}`)) throw new Error(`.env.${target} is required.`);
const environment = Object.fromEntries(readFileSync(`.env.${target}`, "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const separator = line.indexOf("="); return [line.slice(0, separator), line.slice(separator + 1)]; }));
if (environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== aliases[target] || environment.GCLOUD_PROJECT !== aliases[target]) throw new Error(`${target} environment project ID must match its Firebase alias.`);
const opposite = target === "staging" ? "production" : "staging";
if (aliases[opposite] && environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID === aliases[opposite]) throw new Error(`${target} configuration resolves to the ${opposite} project.`);
const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (status && process.env.ALLOW_DIRTY_DEPLOY !== "true") throw new Error("Worktree is not clean. Set ALLOW_DIRTY_DEPLOY=true only after reviewing every change.");
const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
if (target === "production" && branch !== "main") throw new Error("Production validation is restricted to the main branch.");
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
for (const file of tracked) {
  if (!existsSync(file)) continue;
  const content = readFileSync(file, "utf8");
  if (content.includes("FIREBASE_APPCHECK_DEBUG_TOKEN=true")) throw new Error(`Committed App Check debug token in ${file}.`);
}
console.log(`Deployment safeguards passed for ${target} (${aliases[target]}), branch ${branch}. No deployment was executed.`);
