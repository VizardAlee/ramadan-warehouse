import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { screenshotLimit, supportRecipient } from "./domain.js";
import { privateScreenshot } from "./image.js";
import { SupportDeliveryRejected, SupportDeliveryUncertain, type SupportMail, type SupportTransport } from "./store.js";

export const supportSender = "biggy0023@gmail.com";
/** Fixed-envelope single-recipient SMTP; no URLs, filesystem attachments or customer replies. */
export function gmailSupportTransport(password: string, createTransport = nodemailer.createTransport): SupportTransport {
  if (!/^[a-z0-9]{16}$/i.test(password.replace(/\s/g, ""))) throw new Error("Support mail is not configured.");
  const smtp = createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: supportSender, pass: password.replace(/\s/g, "") }, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true }, pool: false, connectionTimeout: 20000, greetingTimeout: 10000, socketTimeout: 30000, dnsTimeout: 10000, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true, maxRecipients: 1 });
  return { async send(mail: SupportMail) {
    if (mail.to !== supportRecipient || !/^\[Ramadan Support\] Ticket RS-[a-f0-9]{32}$/.test(mail.subject) || typeof mail.text !== "string" || Buffer.byteLength(mail.text) > 40000 || !/^[-a-zA-Z0-9_]+:RS-[a-f0-9]{32}$/.test(mail.idempotencyKey)) throw new SupportDeliveryRejected();
    if (mail.attachment && (mail.attachment.contentType !== "image/png" || !/^RS-[a-f0-9]{32}\.png$/.test(mail.attachment.filename) || Buffer.byteLength(mail.attachment.base64, "base64") > screenshotLimit)) throw new SupportDeliveryRejected();
    let image: ReturnType<typeof privateScreenshot> | null = null;
    try { image = mail.attachment ? privateScreenshot(mail.attachment.base64) : null; } catch { throw new SupportDeliveryRejected(); }
    try {
      const result = await smtp.sendMail({ from: { name: "Ramadan Support", address: supportSender }, to: supportRecipient, envelope: { from: supportSender, to: [supportRecipient] }, subject: mail.subject, text: mail.text, messageId: `<ramadan-support-${createHash("sha256").update(mail.idempotencyKey).digest("hex")}@gmail.com>`, disableFileAccess: true, disableUrlAccess: true, ...(image ? { attachments: [{ filename: mail.attachment!.filename, contentType: "image/png", content: Buffer.from(image.base64, "base64"), contentDisposition: "attachment" as const }] } : {}) });
      if (result.rejected?.length || !result.accepted?.some(address => typeof address === "string" && address.toLowerCase() === supportRecipient)) throw new SupportDeliveryUncertain();
      return { accepted: true as const, providerReference: String(result.messageId ?? "accepted").slice(0, 200) };
    } catch (error) {
      if (error instanceof SupportDeliveryUncertain) throw error;
      const e = error as { code?: string; responseCode?: number; command?: string };
      if (e.code === "EAUTH" || (Number(e.responseCode) >= 400 && Number(e.responseCode) < 600 && /^(AUTH|MAIL FROM|RCPT TO|DATA)/.test(String(e.command)))) throw new SupportDeliveryRejected();
      throw new SupportDeliveryUncertain();
    } finally { smtp.close(); }
  } };
}
