import { describe, expect, it } from "vitest";
import { supportGatewayConfig } from "../scripts/support-gateway-config.mjs";
describe("private support Gateway configuration", () => {
  it.each(["https://supportworkspace-abc123-uc.a.run.app", "https://supportworkspace-482160397815.us-central1.run.app"])("pins IAM audience to the verified untagged service: %s", uri => {
    const config = supportGatewayConfig(uri), routes = config.paths["/supportWorkspace"];
    expect(routes.post.security).toEqual([{ firebase: [] }]);
    expect(routes.post["x-google-backend"]).toMatchObject({ address: uri, jwt_audience: uri, path_translation: "CONSTANT_ADDRESS" });
    expect(routes.options.security).toEqual([]);
    expect(routes.options["x-google-backend"].jwt_audience).toBe(uri);
    expect(config.securityDefinitions.firebase).toMatchObject({ "x-google-issuer": "https://securetoken.google.com/ramadan-warehouse-staging", "x-google-audiences": "ramadan-warehouse-staging" });
  });
  it.each(["http://supportworkspace-abc123-uc.a.run.app", "https://other-abc123-uc.a.run.app", "https://version---supportworkspace-abc123-uc.a.run.app", "https://supportworkspace-123456789012.us-central1.run.app", "https://supportworkspace-abc123-uc.a.run.app?token=bad", "https://supportworkspace-abc123-uc.a.run.app/other"])("rejects unreviewed destinations: %s", uri => expect(() => supportGatewayConfig(uri)).toThrow(/verified/));
});
