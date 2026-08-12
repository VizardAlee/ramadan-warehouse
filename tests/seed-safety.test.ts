import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("emulator seed safety", () => {
  it("refuses to run without explicit emulator hosts and a demo project", async () => {
    const environment = { ...process.env };
    delete environment.FIRESTORE_EMULATOR_HOST;
    delete environment.FIREBASE_AUTH_EMULATOR_HOST;
    delete environment.GCLOUD_PROJECT;
    await expect(execFileAsync(process.execPath, ["scripts/seed-emulator.mjs"], { cwd: process.cwd(), env: environment })).rejects.toMatchObject({
      stderr: expect.stringMatching(/Refusing to seed/),
    });
  });
});
