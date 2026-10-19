"use client";
import { Children, cloneElement, createContext, useCallback, useContext, useEffect, isValidElement, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useAuth } from "@/features/auth/auth-context";

export const FINANCIAL_MASK = "••••";
export const privacyStorageKey = (organizationId: string, uid: string) => `abr-financial-display:v1:${encodeURIComponent(organizationId)}:${encodeURIComponent(uid)}`;
export function storedFinancialPrivacy(value: string | null) {
  try { const data: unknown = JSON.parse(value ?? "null"); return typeof data === "object" && data !== null && "version" in data && data.version === 1 && "hidden" in data && typeof data.hidden === "boolean" ? data.hidden : true; } catch { return true; }
}
type Privacy = { hidden: boolean; screenHidden: boolean; ready: boolean; epoch: string; persistent: boolean; setHidden: (value: boolean) => void };
// Standalone document renderers keep their prior actual-value contract. Every
// application route is enclosed by the identity-aware provider below.
const PrivacyContext = createContext<Privacy>({ hidden: false, screenHidden: false, ready: true, epoch: "standalone-output", persistent: true, setHidden: () => {} });
export const useFinancialPrivacy = () => useContext(PrivacyContext);
export function FinancialPrivacyBoundary({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  return <FinancialPrivacyProvider organizationId={profile?.organizationId} uid={profile?.uid}>{children}</FinancialPrivacyProvider>;
}
export function FinancialPrivacyProvider({ organizationId, uid, children }: { organizationId?: string; uid?: string; children: ReactNode }) {
  const key = organizationId && uid ? privacyStorageKey(organizationId, uid) : "pending-identity";
  return <IdentityPrivacy key={key} storageKey={key} identified={Boolean(organizationId && uid)}>{children}</IdentityPrivacy>;
}
function IdentityPrivacy({ storageKey, identified, children }: { storageKey: string; identified: boolean; children: ReactNode }) {
  const [state, setState] = useState({ ready: false, hidden: true, persistent: true, generation: 0 });
  const live = useRef(true), notice = useId();
  const [submissionBlocked, setSubmissionBlocked] = useState(false);
  useEffect(() => {
    live.current = true;
    function restore() {
      if (!identified || !live.current) return;
      let hidden = true, persistent = true;
      try { hidden = storedFinancialPrivacy(localStorage.getItem(storageKey)); } catch { persistent = false; }
      setState(old => ({ ready: true, hidden, persistent, generation: old.generation + 1 }));
    }
    queueMicrotask(restore);
    const changed = (event: StorageEvent) => { if ((event.key === storageKey || event.key === null)) restore(); };
    window.addEventListener("storage", changed);
    return () => { live.current = false; window.removeEventListener("storage", changed); };
  }, [identified, storageKey]);
  const setHidden = useCallback((hidden: boolean) => {
    if (!identified) return;
    let persistent = true;
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, hidden })); } catch { persistent = false; }
    setState(old => ({ ready: true, hidden, persistent, generation: old.generation + 1 }));
  }, [identified, storageKey]);
  const hidden = !identified || !state.ready || state.hidden;
  const value = useMemo(() => ({ hidden, screenHidden: hidden, ready: identified && state.ready, persistent: state.persistent, epoch: `${storageKey}:${state.generation}`, setHidden }), [hidden, identified, setHidden, state.generation, state.persistent, state.ready, storageKey]);
  return <PrivacyContext.Provider value={value}><div className="contents" onSubmitCapture={event => {
    if ((event.target as HTMLElement).closest("[data-financial-action-scope]")) return;
    const closed = Array.from((event.target as HTMLElement).querySelectorAll<HTMLButtonElement>("[data-financial-input-hidden] button")).find(button => !button.matches(":disabled") || !value.ready);
    if (closed) { event.preventDefault(); event.stopPropagation(); closed.focus(); setSubmissionBlocked(true); } else setSubmissionBlocked(false);
  }}>{children}{submissionBlocked && <div id={notice} role="status" className="financial-form-notice" data-no-print>Review the actual amount fields before submitting this form. Your entered values are retained. <button type="button" onClick={() => setSubmissionBlocked(false)}>Dismiss</button></div>}</div></PrivacyContext.Provider>;
}
const safeStates = new Set(["Unknown", "Needs review", "Unavailable", "Not configured", "Not meaningful", "Restricted", "Not established", "Not recorded", "Not recorded at payment", "—", ""]);
export function FinancialValue({ children, className = "", textOnly = false, financial = true }: { children: ReactNode; className?: string; textOnly?: boolean; financial?: boolean }) {
  const { hidden } = useFinancialPrivacy();
  const masked = financial && hidden && !(typeof children === "string" && safeStates.has(children));
  if (textOnly) return masked ? FINANCIAL_MASK : children;
  if (!masked) return className ? <span className={className}>{children}</span> : children;
  return <span className="financial-value-hidden" data-financial-value aria-label="Financial value hidden">{FINANCIAL_MASK}</span>;
}
/** Money-like report columns; quantities, dates, rates of stock movement and IDs are excluded. */
export function isFinancialField(key: string) {
  if (/^(?:balanceBefore|balanceAfter|onHand|available|reserved|quantityDelta|reservedQuantityDelta)$/i.test(key)) return false;
  return !/(?:quantity|count|number|reference|code|currency|date|time|unitOfMeasure|id|status|method|direction|type|name|tier|level|days)$/i.test(key) && /(?:minor|naira|amount|balance|cost|price|value|valuation|revenue|profit|margin|debit|credit|income|expense|advance|payment|receipt|vat|tax|variancePercent|rateBasisPoints)/i.test(key);
}
export function FinancialField({ name, children }: { name: string; children: ReactNode }) { return <FinancialValue financial={isFinancialField(name)}>{children}</FinancialValue>; }
export function FinancialAttributes({ children, financial = false }: { financial?: boolean; children: ReactElement<{ title?: string; "aria-label"?: string; "aria-valuetext"?: string }> }) {
  const { hidden } = useFinancialPrivacy();
  return hidden ? cloneElement(children, Object.fromEntries(["title", "aria-label", "aria-valuetext"].filter(key => key in children.props && (financial || containsFinancialText(children.props[key as keyof typeof children.props]))).map(key => [key, "Financial values hidden"]))) : children;
}
export function FinancialDisplayScope({ actual, children }: { actual: boolean; children: ReactNode }) {
  const privacy = useFinancialPrivacy(); return <PrivacyContext.Provider value={actual ? { ...privacy, hidden: false } : privacy}>{children}</PrivacyContext.Provider>;
}
export function FinancialReview({ children, label = "Review actual financial details", className = "", inline = false }: { children: ReactNode; label?: string; className?: string; inline?: boolean }) {
  const privacy = useFinancialPrivacy(), [revealed, setRevealed] = useState<string | null>(null);
  const Wrapper = inline ? "span" : "div";
  const open = !privacy.hidden || (privacy.ready && revealed === privacy.epoch);
  return <Wrapper className={className} data-financial-review>{open ? <><FinancialDisplayScope actual>{children}</FinancialDisplayScope>{privacy.hidden && <span className="financial-review-note" data-no-print>Actual values are visible in this review. <button type="button" onClick={() => setRevealed(null)}>Hide this review</button></span>}</> : <button className="financial-review-control" type="button" disabled={!privacy.ready} onClick={() => setRevealed(privacy.epoch)}>{label}</button>}</Wrapper>;
}
export function FinancialInput({ children }: { children: ReactElement }) {
  const privacy = useFinancialPrivacy(), [revealed, setRevealed] = useState<string | null>(null);
  const inputLabel = (children.props as { "aria-label"?: string })["aria-label"];
  const open = !privacy.hidden || (privacy.ready && revealed === privacy.epoch);
  return <span className="financial-input-review" data-financial-input data-financial-input-hidden={!open && !(children.props as { disabled?: boolean }).disabled || undefined}>{open ? <>{children}{privacy.hidden && <span className="financial-review-note">Actual input visible. <button type="button" aria-label={`Hide input${inputLabel ? `: ${inputLabel}` : ""}`} onClick={() => setRevealed(null)}>Hide input</button></span>}</> : <button className="financial-review-control" type="button" aria-label={`Review / enter actual amount${inputLabel ? `: ${inputLabel}` : ""}`} disabled={!privacy.ready} onClick={() => setRevealed(privacy.epoch)}>Review / enter actual amount</button>}</span>;
}
/** Generic financial/technical text can contain unstructured amounts. */
export function FinancialDetails({ children }: { children: ReactNode }) { return <FinancialReview inline label="Review actual technical details">{children}</FinancialReview>; }
export function useFinancialPrint() {
  const { hidden } = useFinancialPrivacy();
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false); window.addEventListener("afterprint", done);
    const timer = window.setTimeout(() => { try { window.print(); } catch { done(); } }, 50);
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", done); };
  }, [printing]);
  return { printing, printActual: () => { if (hidden) setPrinting(true); else window.print(); } };
}

type PrintRequest = (callback: () => unknown) => void;
const FinancialPrintContext = createContext<PrintRequest>(callback => { callback(); });
/** Scoped actual-value preview/print intent; never changes the global preference. */
export function FinancialDocument({ children }: { children: ReactNode }) {
  const privacy = useFinancialPrivacy(), [reviewed, setReviewed] = useState<string | null>(null), [printing, setPrinting] = useState(false);
  const callback = useRef<(() => unknown) | null>(null);
  const requestPrint = useCallback<PrintRequest>(action => { if (!privacy.hidden || reviewed === privacy.epoch) { action(); return; } callback.current = action; setPrinting(true); }, [privacy.hidden, privacy.epoch, reviewed]);
  useEffect(() => {
    if (!printing) return;
    const done = () => { setPrinting(false); callback.current = null; };
    window.addEventListener("afterprint", done);
    const timer = window.setTimeout(() => { try { callback.current?.(); } catch { done(); } }, 50);
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", done); };
  }, [printing]);
  const actual = printing || reviewed === privacy.epoch;
  return <><div className="financial-review-note" data-no-print>Print and export contain actual values. {privacy.hidden && <button type="button" disabled={!privacy.ready} onClick={() => { setReviewed(actual ? null : privacy.epoch); if (printing) setPrinting(false); }}>{actual ? "Hide document values" : "Review actual document values"}</button>}</div><FinancialDisplayScope actual={actual}><FinancialPrintContext.Provider value={requestPrint}>{children}</FinancialPrintContext.Provider></FinancialDisplayScope></>;
}
export function FinancialPrintAction({ children }: { children: ReactElement<{ onClick?: (event: React.MouseEvent) => unknown }> }) {
  const request = useContext(FinancialPrintContext);
  return cloneElement(children, { onClick: event => request(() => children.props.onClick?.(event)) });
}

export function containsFinancialText(value: unknown): value is string {
  return typeof value === "string" && /(?:[₦$€£]\s*-?\s*[\d,.]+|\b(?:NGN|naira)\s*-?\s*[\d,.]+|\d[\d,.]*\s*(?:naira|NGN)\b)/i.test(value);
}
/** Fallback for currency mentioned in free-form names/references; typed money
 * fields use FinancialValue rather than relying on text detection. */
export function FinancialText({ children }: { children: ReactNode }) {
  const { hidden } = useFinancialPrivacy(); return hidden && containsFinancialText(children) ? FINANCIAL_MASK : children;
}
export function FinancialMessage({ children }: { children: ReactNode }) {
  const { hidden } = useFinancialPrivacy(); return hidden && containsFinancialText(children) ? <FinancialDetails>{children}</FinancialDetails> : children;
}


type ActionReview = { ready: boolean; allowed: boolean; requestReview: () => void };
const FinancialActionContext = createContext<ActionReview | null>(null);
const actionScopeSelector = "[data-financial-action-scope]";
/** Individual input reviews also suffice when no other amounts remain hidden. */
function actionAmountsReviewed(scope: HTMLElement | null, ready: boolean) {
  if (!scope || !ready) return false;
  const closed = Array.from(scope.querySelectorAll<HTMLButtonElement>("[data-financial-input-hidden] button")).some(button => !button.matches(":disabled"));
  const hiddenOption = Array.from(scope.querySelectorAll("option")).some(option => option.textContent?.includes(FINANCIAL_MASK));
  return !closed && !hiddenOption && !scope.querySelector("[data-financial-value]") && Boolean(scope.querySelector("[data-financial-input] input:not(:disabled), [data-financial-input] textarea:not(:disabled)"));
}
/** A local, explicit actual-value review; it never changes the device preference.
 * Clone the existing native container so grids, dialogs, refs and fieldsets keep
 * their original DOM boundaries. Place its control after a native legend/summary. */
export function FinancialActionScope({ children }: { children: ReactElement<{ children?: ReactNode; onSubmitCapture?: (event: React.FormEvent<HTMLElement>) => void; "data-financial-action-scope"?: boolean }> }) {
  const privacy = useFinancialPrivacy(), [reviewed, setReviewed] = useState<string | null>(null), [blocked, setBlocked] = useState(false);
  const reviewControlId = useId();
  const actual = reviewed === privacy.epoch;
  const allowed = !privacy.hidden || (privacy.ready && actual);
  const requestReview = () => { setBlocked(true); document.getElementById(reviewControlId)?.focus(); };
  const control = privacy.hidden ? <div key="financial-action-review" className="financial-action-review" data-no-print>
    <p className="text-sm">{actual ? "Actual amounts are visible in this action region." : "Review actual amounts before recording a new financial instruction."}</p>
    {blocked && !actual && <p role="status" className="text-sm">Nothing was submitted. Your entered amounts are retained.</p>}
    <button id={reviewControlId} className="financial-review-control" type="button" disabled={!privacy.ready} onClick={() => { setReviewed(actual ? null : privacy.epoch); setBlocked(false); }}>{actual ? "Hide action amounts" : "Review all action amounts"}</button>
  </div> : null;
  const content = Children.toArray(children.props.children);
  const first = content[0];
  const at = isValidElement(first) && (first.type === "summary" || first.type === "legend") ? 1 : 0;
  if (control) content.splice(at, 0, control);
  return cloneElement(children, {
    "data-financial-action-scope": true,
    onSubmitCapture: event => {
      if ((event.target as HTMLElement).closest(actionScopeSelector) !== event.currentTarget) { children.props.onSubmitCapture?.(event); return; }
      const retry = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("data-financial-retry") === "true";
      if (!retry && !allowed && !actionAmountsReviewed(event.currentTarget, privacy.ready)) { event.preventDefault(); event.stopPropagation(); requestReview(); return; }
      setBlocked(false); children.props.onSubmitCapture?.(event);
    },
    children: <FinancialActionContext.Provider value={{ ready: privacy.ready, allowed, requestReview }}><FinancialDisplayScope actual={actual}>{content}</FinancialDisplayScope></FinancialActionContext.Provider>,
  });
}
/** Guard the UI action before its original handler can persist or post anything.
 * retry must come from an existing immutable saved-instruction state. Boolean
 * retries also identify native submitters; ref-backed predicates serve direct
 * button handlers and are evaluated only at click time. */
export function FinancialAction({ children, retry = false, financial = true }: { children: ReactElement<{ onClick?: (event: React.MouseEvent<HTMLElement>) => unknown; "data-financial-retry"?: string }>; retry?: boolean | (() => boolean); financial?: boolean }) {
  const privacy = useFinancialPrivacy(), review = useContext(FinancialActionContext), [blocked, setBlocked] = useState(false);
  return <>{cloneElement(children, {
    "data-financial-retry": retry === true ? "true" : undefined,
    onClick: event => {
      const savedRetry = typeof retry === "function" ? retry() : retry;
      // Ref-backed saved instructions are checked only in the event, never during render.
      const scope = event.currentTarget.closest<HTMLElement>(actionScopeSelector);
      if (financial && !savedRetry && !review?.allowed && privacy.hidden && !actionAmountsReviewed(scope, privacy.ready)) {
        event.preventDefault(); event.stopPropagation(); setBlocked(true); review?.requestReview(); return;
      }
      if (financial && !savedRetry && !privacy.ready) { event.preventDefault(); event.stopPropagation(); setBlocked(true); review?.requestReview(); return; }
      setBlocked(false); return children.props.onClick?.(event);
    },
  })}{blocked && !review && <span role="status" className="financial-review-note">Nothing was submitted. Show financial values with the eye control before recording this financial action.</span>}</>;
}
