import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../src/app/manifest";

function pngDimensions(path: string) {
  const file = readFileSync(join(process.cwd(), path));
  expect(file.subarray(1, 4).toString()).toBe("PNG");
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}

describe("PWA install and offline contract", () => {
  it("provides Chrome and Safari install metadata with required icons", () => {
    const value = manifest();
    expect(value).toMatchObject({
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      prefer_related_applications: false,
    });
    expect(value.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", type: "image/png" }),
      expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "maskable" }),
    ]));
    expect(pngDimensions("public/icons/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngDimensions("public/icons/icon-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngDimensions("public/icons/maskable-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngDimensions("public/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });

  it("limits offline caching to the app shell, static assets, and visited POS shell", () => {
    const worker = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
    expect(worker).toContain('"/offline"');
    expect(worker).toContain('url.pathname === "/pos"');
    expect(worker).toContain('key.startsWith("abr-")');
    expect(worker).toContain('event.request.method !== "GET"');
    expect(worker).toContain("url.origin !== self.location.origin");
    expect(worker).not.toMatch(/firestore|cloudfunctions|identitytoolkit/i);
  });
});
