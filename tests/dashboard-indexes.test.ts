import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));
const validator = resolve("scripts/validate-firebase-config.mjs");
type Index = { collectionGroup: string; fields: { fieldPath: string; order: string }[] };

function validate(indexes: Index[]) {
  const directory = mkdtempSync(join(tmpdir(), "ramadan-dashboard-indexes-"));
  try {
    writeFileSync(join(directory, "firebase.json"), readFileSync("firebase.json"));
    writeFileSync(join(directory, "firestore.indexes.json"), JSON.stringify({ ...manifest, indexes }));
    return execFileSync(process.execPath, [validator], { cwd: directory, stdio: "pipe" }).toString();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("dashboard count index release guard", () => {
  it("accepts the complete manifest", () => {
    expect(validate(manifest.indexes)).toContain("validation passed");
  });
  for (const fields of [["branchId", "organizationId", "recordedAt"], ["organizationId", "recordedAt"]]) {
    const matches = (index: Index) => index.collectionGroup === "sales" &&
      index.fields.map((field) => field.fieldPath).join(",") === fields.join(",");
    it(`rejects missing count-only index for ${fields.join(", ")}`, () => {
      expect(() => validate(manifest.indexes.filter((index: Index) => !matches(index)))).toThrow();
    });
    it(`rejects descending count-only index for ${fields.join(", ")}`, () => {
      const indexes = manifest.indexes.map((index: Index) => matches(index) ? {
        ...index, fields: index.fields.map((field) => field.fieldPath === "recordedAt" ? { ...field, order: "DESCENDING" } : field),
      } : index);
      expect(() => validate(indexes)).toThrow();
    });
  }
});
