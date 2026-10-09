import { describe, expect, it } from "vitest";
import { decodeCollectionPhoto } from "../functions/src/sales/collection-evidence";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDqkAAAAASUVORK5CYII=";
describe("collection photo validation", () => {
  it("accepts a bounded PNG and fingerprints its bytes", () => {
    expect(decodeCollectionPhoto(png, "image/png")).toMatchObject({ width: 1, height: 1 });
    expect(decodeCollectionPhoto(png, "image/png").sha256).toHaveLength(64);
  });
  it("rejects MIME spoofing, invalid base64 and excessive size", () => {
    expect(() => decodeCollectionPhoto(png, "image/jpeg")).toThrow();
    expect(() => decodeCollectionPhoto("<script>bad</script>", "image/png")).toThrow();
    expect(() => decodeCollectionPhoto(Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"), "image/png")).toThrow();
  });
  it("rejects unreasonable image dimensions", () => {
    const bytes = Buffer.from(png, "base64"); bytes.writeUInt32BE(999999, 16);
    expect(() => decodeCollectionPhoto(bytes.toString("base64"), "image/png")).toThrow();
  });
});
