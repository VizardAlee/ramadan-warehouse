import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/firebase/config", () => ({ getFirebaseConfig: () => ({ authDomain: "fixture.firebaseapp.com", projectId: "fixture" }) }));
import { passwordSetupLink } from "../src/features/auth/password-setup-link";
const origin = "https://fixture.hosted.app";
const original = "https://fixture.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=fixture-code&apiKey=public-fixture&continueUrl=https://untrusted.invalid";
describe("invitation setup routing", () => {
  it("maps only trusted reset links, stripping unrelated URL inputs", () => { expect(passwordSetupLink(original, origin)).toBe(`${origin}/setup-password?mode=resetPassword&oobCode=fixture-code`); });
  it.each([original.replace("resetPassword", "verifyEmail"), original.replace("resetPassword", "recoverEmail"), original.replace("fixture.firebaseapp.com", "untrusted.invalid"), original.replace("oobCode=fixture-code", "oobCode="), original.replace("https:", "http:"), "not-a-url"])("preserves other or malformed link flows", link => { expect(passwordSetupLink(link, origin)).toBe(link); });
  it("preserves emulator links and empty results", () => { expect(passwordSetupLink(original, "http://localhost:3000")).toBe(original); expect(passwordSetupLink(null, origin)).toBeNull(); });
});
