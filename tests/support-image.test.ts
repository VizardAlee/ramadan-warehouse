import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pngCrc, privateScreenshot } from "../functions/src/support/image";
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
function chunk(type: string, data: Buffer) { const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(pngCrc(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc]); }
function image(extra=Buffer.alloc(0),raw=Buffer.from([0,255,255,255,255]),width=1) { const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;return Buffer.concat([signature,chunk("IHDR",header),extra,chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]); }
describe("private support PNG validation", () => {
  it("keeps valid pixels while removing embedded metadata and original filenames", () => {
    const result=privateScreenshot(image(chunk("tEXt",Buffer.from("Comment\0synthetic private metadata"))).toString("base64"));
    expect(result).toMatchObject({mimeType:"image/png",width:1,height:1});
    expect(Buffer.from(result.base64,"base64").includes(Buffer.from("private metadata"))).toBe(false);
    expect(result).not.toHaveProperty("filename");
  });
  it("rejects corruption, trailing data and unsupported critical chunks", () => {
    const broken=image();broken[broken.length-1]=broken[broken.length-1]!^1;
    expect(()=>privateScreenshot(broken.toString("base64"))).toThrow(/checksum/);
    expect(()=>privateScreenshot(Buffer.concat([image(),Buffer.from("extra")]).toString("base64"))).toThrow();
    expect(()=>privateScreenshot(image(chunk("ABCD",Buffer.alloc(0))).toString("base64"))).toThrow(/Unsupported/);
  });
  it("bounds both decoded pixels and compressed input", () => {
    expect(()=>privateScreenshot(image(Buffer.alloc(0),Buffer.alloc(1_000_000)).toString("base64"))).toThrow(/oversized|coverage/);
    expect(()=>privateScreenshot(image(Buffer.alloc(0),Buffer.alloc(5),1921).toString("base64"))).toThrow(/1920/);
    expect(()=>privateScreenshot(Buffer.alloc(131073).toString("base64"))).toThrow(/128 KB/);
  });
});
