import type { DecodedIdToken } from "firebase-admin/auth";
import { describe, expect, it, vi } from "vitest";
import { HttpsError, supportGateway, supportOrigins, type SupportHttpInput } from "../functions/src/support/gateway";
import { SupportInputError } from "../functions/src/support/domain";
const token = { uid: "owner", sub: "owner", aud: "ramadan-warehouse-staging", iss: "https://securetoken.google.com/ramadan-warehouse-staging", exp: 2000000000 } as DecodedIdToken;
const input = (): SupportHttpInput => ({ method: "POST", path: "/", headers: { origin: supportOrigins[0], "x-forwarded-authorization": "Bearer one.two.three", "x-firebase-appcheck": "app-proof", "content-type": "application/json" }, body: { data: { action: "list" } } });
const call = (request = input(), user = token, execute = vi.fn(async () => ({ tickets: [] }))) => supportGateway(request, "ramadan-warehouse-staging", async () => user, async () => ({}), execute, () => 1000000);
describe("private Ramadan support Gateway boundary", () => {
  it("returns a correctable validation error before a report is saved", async () => {
    const result = await call(input(), token, vi.fn(async () => { throw new SupportInputError("Review the PNG screenshot."); }));
    expect(result).toMatchObject({ status: 400, body: { error: { status: "INVALID_ARGUMENT", message: "Review the PNG screenshot." } } });
  });
  it("independently verifies the original Firebase JWT and App Check before executing", async () => {
    const verify = vi.fn(async () => token), app = vi.fn(async () => ({})), execute = vi.fn(async (request: unknown) => ({ saved: Boolean(request) }));
    expect(await supportGateway(input(), token.aud, verify, app, execute)).toMatchObject({ status: 200, body: { data: { saved: true } }, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": supportOrigins[0] } });
    expect(verify).toHaveBeenCalledWith("one.two.three"); expect(app).toHaveBeenCalledWith("app-proof"); expect(execute.mock.calls[0]?.[0]).toMatchObject({ auth: { uid: "owner" } });
  });
  it.each([{ aud: "beacon" }, { iss: "https://attacker.test" }, { sub: "another" }, { exp: 1 }])("rejects a wrong or expired identity: %j", async patch => { expect((await call(input(), { ...token, ...patch })).status).toBe(401); });
  it("does not trust Gateway identity, decoded headers or query-string tokens as user authority", async () => {
    const request = input(); delete request.headers["x-forwarded-authorization"]; request.headers.authorization = "Bearer g.w.y"; request.headers["x-apigateway-api-userinfo"] = "forged";
    expect((await call(request)).status).toBe(401);
    request.path = "/?token=one.two.three"; expect((await call(request)).status).toBe(404);
  });
  it("rejects missing or invalid App Check without running the action", async () => {
    const request = input(), execute = vi.fn(); delete request.headers["x-firebase-appcheck"];
    expect((await call(request, token, execute)).status).toBe(401); expect(execute).not.toHaveBeenCalled();
    const result = await supportGateway(input(), token.aud, async () => token, async () => { throw Error("private verifier detail"); }, execute);
    expect(result.status).toBe(401); expect(JSON.stringify(result)).not.toContain("private verifier detail"); expect(execute).not.toHaveBeenCalled();
  });
  it("allows only exact Ramadan origins and expected preflight headers", async () => {
    const request = input(); request.headers.origin = "https://abramadan.svoltnigeria.com.attacker.test"; expect((await call(request)).status).toBe(403);
    request.headers.origin = supportOrigins[0]; request.method = "OPTIONS"; request.headers["access-control-request-method"] = "POST"; request.headers["access-control-request-headers"] = "authorization, x-firebase-appcheck, content-type";
    expect((await call(request)).status).toBe(204); request.headers["access-control-request-headers"] = "x-untrusted"; expect((await call(request)).status).toBe(403);
  });
  it("rejects oversized or extra envelope fields", async () => {
    const request = input(); request.body = { data: {}, auth: { uid: "admin" } }; expect((await call(request)).status).toBe(400);
    request.body = { data: { large: "x".repeat(262145) } }; expect((await call(request)).status).toBe(400);
  });
  it("returns expected action errors but hides unexpected exception details", async () => {
    expect((await call(input(), token, vi.fn(async () => { throw new HttpsError("permission-denied", "Ticket unavailable."); }))).status).toBe(403);
    const result = await call(input(), token, vi.fn(async () => { throw Error("secret stack and token"); })); expect(result.status).toBe(500); expect(JSON.stringify(result)).not.toContain("secret stack");
  });
});
