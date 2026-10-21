import { describe, expect, it } from "vitest";
import { sanitizeSupportContext, supportFormFeedback, supportReadable, supportSubject, validateSupportInput, type SupportActor } from "../functions/src/support/domain";
const actor: SupportActor = { organizationId: "org", userId: "owner", roleIds: ["sales_cashier"], directRoleIds: ["sales_cashier"], branchIds: ["one"], warehouseIds: [], authorizationVersion: 1, scope: { type: "branch", id: "one" } };
const report = (description = "A useful description") => ({ requestId: "a8b9524f-c502-4811-bf7d-3ca493378135", kind: "bug", description, privacyConfirmed: true, context: {} });
describe("private Ramadan support contract", () => {
  it.each(["", "short", "  123456789  ", "😀😀😀😀😀"])("explains and rejects a trimmed short description: %s", description => {
    expect(supportFormFeedback(description, true, false, false).tooShort).toBe(true);
    expect(() => validateSupportInput(report(description))).toThrow(/10/);
  });
  it("accepts exactly ten trimmed characters and reports the same count", () => {
    expect(validateSupportInput(report("  1234567890  ")).description).toBe("1234567890");
    expect(supportFormFeedback("  1234567890  ", true, false, false)).toMatchObject({ count: 10, tooShort: false, send: "Ready to send your private report." });
  });
  it("explains separate privacy and image-processing blockers", () => {
    expect(supportFormFeedback("Valid description", false, false, false).send).toContain("privacy confirmation");
    expect(supportFormFeedback("Valid description", true, true, false).send).toContain("screenshot");
    expect(() => validateSupportInput({ ...report(), privacyConfirmed: false })).toThrow(/privacy/i);
  });
  it("strips record IDs, queries, full URLs, tokens and unapproved diagnostics", () => {
    expect(sanitizeSupportContext({ screen: "/customers/private-record?token=secret", build: "3eec2d1", browser: "Chrome", device: "mobile", clientTime: "2026-10-21T12:00:00Z", errorReference: "ERR-123", pageContents: "private", token: "secret", rawAgent: "fingerprint" })).toEqual({ screen: "/customers/:id", build: "3eec2d1", browser: "Chrome", device: "mobile", clientTime: "2026-10-21T12:00:00Z", errorReference: "ERR-123" });
    expect(sanitizeSupportContext({ screen: "https://example.test/?secret=1", errorReference: "a private stack trace" }).screen).toBe("/other");
    expect(() => validateSupportInput({ ...report(), token: "not-allowed" })).toThrow(/Unsupported/);
  });
  it("keeps tenant, owner, selected branch and reassignment boundaries", () => {
    const ticket = { organizationId: "org", ownerUid: "owner", scope: { type: "branch" as const, id: "one" } };
    expect(supportReadable(actor, ticket)).toBe(true);
    expect(supportReadable(actor, { ...ticket, organizationId: "foreign" })).toBe(false);
    expect(supportReadable(actor, { ...ticket, ownerUid: "another" })).toBe(false);
    expect(supportReadable({ ...actor, branchIds: [] }, ticket)).toBe(false);
    expect(supportReadable({ ...actor, scope: { type: "branch", id: "two" } }, ticket)).toBe(false);
  });
  it("does not grant custom administrator-base roles global private-ticket access", () => {
    const ticket = { organizationId: "org", ownerUid: "another", scope: { type: "branch" as const, id: "one" } };
    expect(supportReadable({ ...actor, roleIds: ["system_administrator"], directRoleIds: [], scope: { type: "organization", id: "org" } }, ticket)).toBe(false);
    expect(supportReadable({ ...actor, roleIds: ["system_administrator"], directRoleIds: ["system_administrator"], scope: { type: "organization", id: "org" } }, ticket)).toBe(true);
  });
  it("fixes the mail subject and rejects unbounded attachment fields", () => {
    expect(supportSubject("RS-abc")).toBe("[Ramadan Support] Ticket RS-abc");
    expect(() => validateSupportInput({ ...report(), screenshot: { base64: "AAAA", url: "https://example.test/private" } })).toThrow(/PNG/);
    expect(supportFormFeedback("x".repeat(4001), true, false, false).tooLong).toBe(true);
  });
});
