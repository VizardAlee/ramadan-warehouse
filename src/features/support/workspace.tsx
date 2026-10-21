"use client";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Feedback } from "@/components/ui/feedback";
import { supportFormFeedback, supportScreen, type SupportInput } from "../../../functions/src/support/domain";
import { callSupport, loadSupportConfig, prepareSupportScreenshot, supportContext, type SupportConfig, type SupportPage, type SupportTicket } from "@/features/support/client";

const message = (error: unknown) => error instanceof Error ? error.message : "Private support could not load. Try again.";
const label = (value: string) => value.replace(/_/g, " ");
const date = (value: number) => new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Lagos" }) + " (Lagos)";
export function SupportWorkspace() {
  const [config, setConfig] = useState<SupportConfig | null>(null), [page, setPage] = useState<SupportPage | null>(null), [all, setAll] = useState(false);
  const [description, setDescription] = useState(""), [expected, setExpected] = useState(""), [kind, setKind] = useState<SupportInput["kind"]>("bug"), [screen, setScreen] = useState("/help"), [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false), [image, setImage] = useState<{ base64: string; preview: string } | null>(null), [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [uncertain, setUncertain] = useState(false), [receipt, setReceipt] = useState<SupportTicket | null>(null);
  const [ticket, setTicket] = useState<SupportTicket | null>(null), [ticketImage, setTicketImage] = useState<string | null>(null);
  const pending = useRef<SupportInput | null>(null), sending = useRef(false), alive = useRef(true), imageGeneration = useRef(0), reading = useRef(0);
  const receiptPanel = useRef<HTMLElement | null>(null), ticketPanel = useRef<HTMLElement | null>(null);
  const savedTicketId = receipt?.id, openedTicketId = ticket?.id;
  useEffect(() => { if (savedTicketId) { receiptPanel.current?.focus(); receiptPanel.current?.scrollIntoView?.({ block: "start" }); } }, [savedTicketId]);
  useEffect(() => { if (openedTicketId) { ticketPanel.current?.focus(); ticketPanel.current?.scrollIntoView?.({ block: "start" }); } }, [openedTicketId]);
  const feedback = supportFormFeedback(description, confirmed, processing, busy), expectedTooLong = Array.from(expected.trim()).length > 2000;
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    loadSupportConfig().then(async next => {
      const result = await callSupport<SupportPage>(next, { action: "list" });
      if (!alive.current || cancelled) return;
      setConfig(next); setPage(result);
      const linkedId = new URL(window.location.href).searchParams.get("ticket");
      if (linkedId && /^RS-[a-f0-9]{32}$/.test(linkedId)) {
        const linked = await callSupport<SupportTicket>(next, { action: "get", id: linkedId });
        if (alive.current && !cancelled) setTicket(linked);
      }
    }).catch(e => { if (alive.current && !cancelled) setError(message(e)); }).finally(() => { if (alive.current && !cancelled) setLoading(false); });
    return () => { cancelled = true; alive.current = false; };
  }, []);
  useEffect(() => {
    if (!description || receipt) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [description, receipt]);
  const load = useCallback(async (nextAll = all, cursor?: string) => {
    const attempt = ++reading.current; setLoading(true); setError("");
    try { const next = config ?? await loadSupportConfig(); const result = await callSupport<SupportPage>(next, { action: "list", all: nextAll, ...(cursor ? { cursor } : {}) }); if (alive.current && attempt === reading.current) { setConfig(next); setPage(result); setAll(nextAll); } }
    catch (e) { if (alive.current && attempt === reading.current) setError(message(e)); }
    finally { if (alive.current && attempt === reading.current) setLoading(false); }
  }, [all, config]);
  async function open(id: string) {
    if (!config || busy) return;
    const attempt = ++reading.current; setLoading(true); setTicket(null); setTicketImage(null); setError("");
    try { const result = await callSupport<SupportTicket>(config, { action: "get", id }); if (alive.current && attempt === reading.current) setTicket(result); }
    catch (e) { if (alive.current && attempt === reading.current) setError(message(e)); }
    finally { if (alive.current && attempt === reading.current) setLoading(false); }
  }
  async function attach(file?: File) {
    if (!file || uncertain || busy) return;
    const generation = ++imageGeneration.current; setProcessing(true); setConfirmed(false); setImage(null); setError("");
    try { const result = await prepareSupportScreenshot(file); if (alive.current && generation === imageGeneration.current) setImage(result); }
    catch (e) { if (alive.current && generation === imageGeneration.current) setError(message(e)); }
    finally { if (alive.current && generation === imageGeneration.current) setProcessing(false); }
  }
  async function send() {
    if (!config || sending.current || processing || (!pending.current && (feedback.tooShort || feedback.tooLong || expectedTooLong || !confirmed))) return;
    sending.current = true; setBusy(true); setError("");
    const report = pending.current ?? { requestId: crypto.randomUUID(), kind, description, expected, privacyConfirmed: true as const, context: supportContext(screen, config.build, reference), ...(image ? { screenshot: { base64: image.base64 } } : {}) };
    pending.current = report;
    try {
      const result = await callSupport<SupportTicket>(config, { action: "create", report });
      if (alive.current) { setReceipt(result); setUncertain(false); setImage(null); pending.current = null; await load(false); }
    } catch (e) {
      if (!alive.current) return;
      if ((e as { code?: string }).code === "functions/invalid-argument") { pending.current = null; setUncertain(false); setError(message(e)); }
      else { setUncertain(true); setError("Receipt is not confirmed. This draft is preserved on this screen. Retry the unchanged report with the same reference, or check My tickets before starting another report."); }
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  async function update(action: "status" | "retryNotification", status?: SupportTicket["status"]) {
    if (!config || !ticket || sending.current) return;
    sending.current = true; setBusy(true); setError("");
    try { const result = await callSupport<SupportTicket>(config, { action, id: ticket.id, ...(action === "status" ? { status, revision: ticket.revision } : {}) }); if (alive.current) { setTicket(result); await load(); } }
    catch (e) { if (alive.current) setError(message(e)); }
    finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  async function showImage() {
    if (!config || !ticket) return;
    const id = ticket.id, attempt = ++reading.current; setLoading(true); setError("");
    try { const result = await callSupport<{ mimeType: string; base64: string }>(config, { action: "attachment", id }); if (alive.current && attempt === reading.current && result.mimeType === "image/png") setTicketImage("data:image/png;base64," + result.base64); }
    catch (e) { if (alive.current && attempt === reading.current) setError(message(e)); }
    finally { if (alive.current && attempt === reading.current) setLoading(false); }
  }
  const sendReason = !config ? "Private support is unavailable until its connection is configured." : expectedTooLong ? "Shorten the expected outcome to 2,000 characters." : feedback.send;
  const inputClass = "mt-2 min-h-11 w-full min-w-0 rounded-lg border bg-[var(--control-bg)] p-3 text-[var(--foreground)]";
  return <div className="page-stack mx-auto w-full max-w-5xl">
    <header><p className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">Private support</p><h1 className="mt-2 text-3xl font-semibold">Help &amp; feedback</h1><p className="mt-3 max-w-3xl leading-7">Report a problem, ask for help or suggest an improvement. Your ticket is visible to you and authorized system administrators within your organization and reporting location.</p><Link className="mt-3 inline-block min-h-11 py-2 font-semibold underline" href="/guide">Open the user guide</Link></header>
    <section className="surface space-y-3 p-5 sm:p-6" aria-labelledby="privacy-title"><h2 id="privacy-title" className="text-xl font-semibold">Review before sending</h2><p>Do not include passwords, bank details, payment links, tokens, private customer records or unrelated browser content. Attach only a PNG you have already cropped to the issue, and check its preview. Image metadata is removed. Screenshots have no public link.</p><p>Your authenticated account, organization, reporting location and assigned role names identify the report. Diagnostics include only the selected app screen without record IDs or query strings, app build, time, coarse device/browser category and an optional error reference. We do not capture the page, broad logs, browser history or other apps. Support notifications go to the support team; no automatic reply is sent to customers.</p><p className="text-sm text-[var(--muted)]">Draft text and images stay in memory on this screen. Changing account/location, leaving or reloading can discard them. Saved tickets remain available in My tickets.</p></section>
    {error && <Feedback tone="danger">{error}</Feedback>}
    {receipt ? <section className="surface space-y-4 p-5 sm:p-6" aria-live="polite" ref={receiptPanel} tabIndex={-1}><h2 className="text-xl font-semibold">Ticket saved privately</h2><p className="break-all font-mono">{receipt.id}</p><p>Status: {label(receipt.status)}. {receipt.notification === "sent" ? "Support notification sent." : "Support notification pending. Your saved ticket remains available even if email is unavailable."}</p><div className="flex flex-wrap gap-3"><Button disabled={busy || loading} onClick={() => void open(receipt.id)}>View saved ticket</Button><Button variant="outline" disabled={busy} onClick={() => { reading.current++; setLoading(false); setTicket(null); setTicketImage(null); setReceipt(null); setDescription(""); setExpected(""); setReference(""); setConfirmed(false); setImage(null); pending.current = null; }}>New report</Button></div></section> : <section className="surface space-y-5 p-5 sm:p-6" aria-labelledby="report-title"><h2 id="report-title" className="text-xl font-semibold">Send a report</h2>
      <fieldset disabled={busy || uncertain} className="min-w-0 space-y-5">
        <div className="grid min-w-0 gap-5 sm:grid-cols-2"><label className="min-w-0 font-medium">Report type<select className={inputClass} value={kind} onChange={e => { setKind(e.target.value as SupportInput["kind"]); setConfirmed(false); }}><option value="bug">Bug or problem</option><option value="help">Help request</option><option value="suggestion">Suggestion</option></select></label><label className="min-w-0 font-medium">App screen<input className={inputClass} value={screen} maxLength={150} onChange={e => { setScreen(e.target.value); setConfirmed(false); }} placeholder="/pos" aria-describedby="screen-note"/><span id="screen-note" className="mt-2 block text-sm font-normal text-[var(--muted)]">Use a page such as /pos. Saved screen: {supportScreen(screen)}. Unknown pages are recorded as /other.</span></label></div>
        <label className="block font-medium" htmlFor="support-description">What happened?<span className="mt-1 block text-sm font-normal text-[var(--muted)]">Use at least 10 characters after spaces at the ends are removed. Maximum 4,000 characters.</span></label><textarea id="support-description" className={inputClass} rows={6} maxLength={8000} value={description} onChange={e => { setDescription(e.target.value); setConfirmed(false); }} aria-describedby="support-count"/><p id="support-count" aria-live="polite" className="text-sm text-[var(--muted)]">{feedback.description}</p>
        <label className="block font-medium">What did you expect? <span className="font-normal">(optional; maximum 2,000 characters)</span><textarea className={inputClass} rows={3} maxLength={4000} value={expected} onChange={e => { setExpected(e.target.value); setConfirmed(false); }}/></label>
        <label className="block font-medium">Error reference <span className="font-normal">(optional)</span><input className={inputClass} value={reference} maxLength={80} pattern="[-a-zA-Z0-9_]*" onChange={e => { setReference(e.target.value.replace(/[^-a-zA-Z0-9_]/g, "")); setConfirmed(false); }}/></label>
        <label className="block font-medium">Cropped PNG screenshot <span className="font-normal">(optional)</span><input type="file" accept="image/png" className="mt-3 block max-w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:px-3" disabled={processing} onChange={e => { const file = e.target.files?.[0]; e.currentTarget.value = ""; void attach(file); }}/><span className="mt-2 block text-sm font-normal text-[var(--muted)]">Choose a cropped file up to 5 MB. The prepared screenshot must fit within 128 KB. No screenshot is captured automatically.</span></label>
      </fieldset>
      {processing && <p role="status">Preparing screenshot…</p>}{image && <div className="space-y-3"><Image unoptimized src={image.preview} width={1280} height={720} alt="Your screenshot preview: review for private information before sending" className="h-auto max-h-96 w-auto max-w-full rounded-lg border object-contain"/><Button variant="outline" disabled={busy || uncertain} onClick={() => { imageGeneration.current++; setImage(null); setProcessing(false); setConfirmed(false); }}>Remove screenshot</Button></div>}
      <label className="flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1 size-5 shrink-0" checked={confirmed} disabled={busy || uncertain || processing} onChange={e => setConfirmed(e.target.checked)}/><span>I reviewed the text and screenshot and removed private or unrelated information.</span></label>
      <Button onClick={() => void send()} disabled={busy || !config || processing || (!uncertain && (feedback.tooShort || feedback.tooLong || expectedTooLong || !confirmed))} disabledReason={sendReason}>{busy ? "Saving ticket…" : uncertain ? "Retry unchanged report" : "Send private report"}</Button>
    </section>}
    <section className="surface space-y-4 p-5 sm:p-6" aria-labelledby="tickets-title"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="tickets-title" className="text-xl font-semibold">{all ? "Organization support queue" : "My tickets"}</h2><Button variant="outline" disabled={loading || busy} onClick={() => void load()}>Refresh tickets</Button></div>{page?.canAdmin && <div className="flex flex-wrap gap-3"><Button variant={!all ? "primary" : "outline"} disabled={loading || busy} onClick={() => void load(false)}>My tickets</Button><Button variant={all ? "primary" : "outline"} disabled={loading || busy} onClick={() => void load(true)}>Support queue</Button></div>}<p className="text-sm text-[var(--muted)]">Current organization and selected location apply. Latest first; up to 20 records are checked per page. An empty page can still have More tickets.</p>{loading && <p role="status">Loading private tickets…</p>}{!loading && page?.tickets.length === 0 && <p>No matching tickets on this page.</p>}<ul className="space-y-3">{page?.tickets.map(t => <li key={t.id} className="min-w-0 rounded-xl border p-4"><button className="min-h-11 max-w-full break-all py-2 text-left font-mono font-semibold underline" onClick={() => void open(t.id)} disabled={loading || busy}>{t.id}</button><p className="text-sm">{label(t.kind)} · {label(t.status)} · {date(t.createdAt)}</p><p className="mt-2 line-clamp-2 break-words [overflow-wrap:anywhere]">{t.description}</p></li>)}</ul>{page?.nextCursor && <Button variant="outline" disabled={loading || busy} onClick={() => void load(all, page.nextCursor!)}>More tickets</Button>}</section>
    {ticket && <section className="surface min-w-0 space-y-4 p-5 sm:p-6" aria-labelledby="ticket-title" ref={ticketPanel} tabIndex={-1}><div className="flex flex-wrap items-start justify-between gap-3"><h2 id="ticket-title" className="min-w-0 break-all font-mono text-lg font-semibold">{ticket.id}</h2><Button variant="outline" disabled={busy} onClick={() => { reading.current++; setLoading(false); setTicket(null); setTicketImage(null); }}>Close ticket</Button></div><p>{label(ticket.kind)} · {label(ticket.status)} · {date(ticket.createdAt)}</p><h3 className="font-semibold">Description</h3><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{ticket.description}</p>{ticket.expected && <><h3 className="font-semibold">Expected outcome</h3><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{ticket.expected}</p></>}<details className="rounded-lg border p-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Saved diagnostic context</summary><dl className="space-y-2 break-words [overflow-wrap:anywhere]">{Object.entries(ticket.context).map(([key, value]) => <div key={key}><dt className="font-medium">{label(key)}</dt><dd>{value || "Not recorded"}</dd></div>)}</dl></details><p>{ticket.notification === "sent" ? "Support notification sent." : "Notification pending. This saved ticket is available independently of email delivery."}</p>{ticket.hasScreenshot && !ticketImage && <Button variant="outline" disabled={loading || busy} onClick={() => void showImage()}>Review private screenshot</Button>}{ticketImage && <Image unoptimized src={ticketImage} alt="Private screenshot attached to this ticket" width={1280} height={720} className="h-auto max-h-96 w-auto max-w-full rounded-lg border object-contain"/>}{page?.canAdmin && <div className="space-y-3 border-t pt-4"><h3 className="font-semibold">Administrator actions</h3><p className="break-all text-sm">Submitted by account: {ticket.submittedByUid ?? "Not recorded"} · {ticket.scope.type}: {ticket.scope.id}</p><p className="text-sm">Notification: {label(ticket.notificationState ?? "pending")}. Uncertain delivery is never resent automatically; reconcile it before taking further action.</p><div className="flex flex-wrap gap-3">{(["new", "in_progress", "resolved"] as const).map(status => <Button key={status} variant="outline" disabled={busy || ticket.status === status} disabledReason={ticket.status === status ? "The ticket already has this status." : undefined} onClick={() => void update("status", status)}>Mark {label(status)}</Button>)}</div>{ticket.canRetryNotification && <Button variant="outline" disabled={busy} onClick={() => void update("retryNotification")}>Queue confirmed unsent notification</Button>}<Button variant="outline" disabled={busy || loading} onClick={() => void open(ticket.id)}>Refresh ticket before updating</Button></div>}</section>}
  </div>;
}
