import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
vi.mock("../functions/src/admin", () => ({ db: {} }));
import { gmailSupportTransport, supportSender } from "../functions/src/support/mail";
import { SupportDeliveryRejected, SupportDeliveryUncertain, type SupportMail } from "../functions/src/support/store";
import { pngCrc } from "../functions/src/support/image";
const id = "RS-" + "a".repeat(32);
const mail = (): SupportMail => ({ to: "servicegurunigeria@gmail.com", subject: "[Ramadan Support] Ticket " + id, text: "Synthetic private support report; not sent over a network", idempotencyKey: "org:" + id });
const fakePassword = "abcdefghijklmnop"; // Synthetic test fixture, never a real credential.
function mockSmtp(error?: unknown) {
  const sendMail = vi.fn(async (payload: unknown) => { expect(payload).toBeTruthy(); if (error) throw error; return { accepted: ["servicegurunigeria@gmail.com"], rejected: [], messageId: "synthetic-message" }; }), close = vi.fn();
  const factory = vi.fn((options: unknown) => { expect(options).toBeTruthy(); return { sendMail, close }; });
  const transport = gmailSupportTransport(fakePassword, factory as unknown as NonNullable<Parameters<typeof gmailSupportTransport>[1]>);
  return { transport, factory, sendMail, close };
}
function png() {
  const chunk = (name: string, data: Buffer) => { const t=Buffer.from(name),s=Buffer.alloc(4),c=Buffer.alloc(4);s.writeUInt32BE(data.length);c.writeUInt32BE(pngCrc(Buffer.concat([t,data])));return Buffer.concat([s,t,data,c]); };
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("tEXt",Buffer.from("private metadata")),chunk("IDAT",deflateSync(Buffer.from([0,0,0,0,255]))),chunk("IEND",Buffer.alloc(0))]).toString("base64");
}
describe("fixed Ramadan SMTP transport (mock only; no credential or network)", () => {
  it("accepts sixteen alphanumeric app-password characters with grouped whitespace", () => {
    const factory = vi.fn(() => ({ sendMail: vi.fn(), close: vi.fn() }));
    expect(() => gmailSupportTransport("abcd 1234 efgh 5678", factory as unknown as NonNullable<Parameters<typeof gmailSupportTransport>[1]>)).not.toThrow();
    expect(factory.mock.calls[0]).toBeTruthy();
    expect(() => gmailSupportTransport("short", factory as unknown as NonNullable<Parameters<typeof gmailSupportTransport>[1]>)).toThrow(/configured/);
  });
  it("uses verified TLS, bounded timeouts, no protocol logs, no file/URL access and one recipient", async () => {
    const { transport, factory, sendMail, close } = mockSmtp(); await expect(transport.send(mail())).resolves.toMatchObject({ accepted: true });
    expect(factory.mock.calls[0]?.[0]).toMatchObject({ host: "smtp.gmail.com", port: 465, secure: true, tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" }, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true, maxRecipients: 1, connectionTimeout: 20000, socketTimeout: 30000 });
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({ from: { address: supportSender }, to: "servicegurunigeria@gmail.com", envelope: { from: supportSender, to: ["servicegurunigeria@gmail.com"] }, subject: mail().subject });
    expect(sendMail.mock.calls[0]?.[0]).not.toHaveProperty("replyTo"); expect(sendMail.mock.calls[0]?.[0]).not.toHaveProperty("cc"); expect(close).toHaveBeenCalledOnce();
  });
  it.each([{ to: "customer@example.test" }, { subject: "Subject\r\nBcc: victim@example.test" }, { idempotencyKey: "bad/reference" }, { text: "😀".repeat(11000) }])("rejects an unsafe envelope before SMTP: %j", async patch => {
    const { transport, sendMail } = mockSmtp(); await expect(transport.send({ ...mail(), ...patch })).rejects.toBeInstanceOf(SupportDeliveryRejected); expect(sendMail).not.toHaveBeenCalled();
  });
  it("accepts the maximum Unicode text budget and canonicalizes only bounded PNG bytes", async () => {
    const { transport, sendMail } = mockSmtp(); await transport.send({ ...mail(), text: "😀".repeat(6000), attachment: { filename: id + ".png", contentType: "image/png", base64: png() } });
    const sent = sendMail.mock.calls[0]?.[0] as unknown as { attachments: { content: Buffer; contentType: string }[] };
    expect(sent.attachments[0]?.contentType).toBe("image/png"); expect(sent.attachments[0]?.content.includes(Buffer.from("private metadata"))).toBe(false);
  });
  it("classifies malformed PNG as definitely unsent rather than uncertain delivery", async () => {
    const { transport, sendMail } = mockSmtp(); await expect(transport.send({ ...mail(), attachment: { filename: id + ".png", contentType: "image/png", base64: "AAAA" } })).rejects.toBeInstanceOf(SupportDeliveryRejected); expect(sendMail).not.toHaveBeenCalled();
  });
  it.each([{ code: "EAUTH" }, { responseCode: 550, command: "RCPT TO" }, { responseCode: 451, command: "DATA" }])("permits manual retry only after explicit rejection: %j", async rejection => {
    const { transport, close } = mockSmtp(rejection); await expect(transport.send(mail())).rejects.toBeInstanceOf(SupportDeliveryRejected); expect(close).toHaveBeenCalledOnce();
  });
  it.each([{ code: "ETIMEDOUT", command: "DATA" }, { code: "ECONNECTION" }, Error("Unknown SMTP failure")])("preserves ambiguous outcomes for reconciliation: %j", async error => {
    const { transport, close } = mockSmtp(error); await expect(transport.send(mail())).rejects.toBeInstanceOf(SupportDeliveryUncertain); expect(close).toHaveBeenCalledOnce();
  });
});
