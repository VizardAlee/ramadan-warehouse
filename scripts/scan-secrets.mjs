import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const root = process.cwd();
const textExtensions = new Set(["", ".env", ".js", ".json", ".md", ".mjs", ".rules", ".ts", ".tsx", ".yaml", ".yml"]);
const findings = [];
const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["service-account credential", /"type"\s*:\s*"service_account"/],
  ["OAuth client secret", /client_secret\s*[=:]\s*["']?(?!replace-with|example|redacted)[A-Za-z0-9_-]{12,}/i],
  ["authorization bearer token", /authorization\s*[=:]\s*["']?bearer\s+[A-Za-z0-9._-]{16,}/i],
  ["enabled App Check debug token", /^\s*(?:NEXT_PUBLIC_)?FIREBASE_APPCHECK_DEBUG_TOKEN\s*=\s*(?:true|[A-Za-z0-9_-]{16,})\s*$/m],
];

const repositoryFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

for (const rel of repositoryFiles) {
  const path = join(root, rel);
  const name = rel.split("/").at(-1) ?? rel;
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 2_000_000 || (!textExtensions.has(extname(name)) && !name.startsWith(".env"))) continue;
  const content = readFileSync(path, "utf8");
  for (const [type, pattern] of patterns) if (pattern.test(content)) findings.push({ path: rel, type });
  if (/^\.env(?:\.|$)/.test(name) && !name.endsWith(".example") && /\S/.test(content)) findings.push({ path: rel, type: "non-example environment file" });
}
if (findings.length) {
  console.error("Potential secrets found (values redacted):");
  for (const finding of findings) console.error(`- ${finding.path}: ${finding.type}`);
  process.exitCode = 1;
} else console.log("Secret scan passed; no likely credential material was detected.");
