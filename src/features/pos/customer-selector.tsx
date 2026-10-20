"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Search, UserRound, X } from "lucide-react";
import styles from "./customer-selector.module.css";
import { Button } from "@/components/ui/button";
import { FinancialText } from "@/features/finance/financial-privacy";
import { callAdministration } from "@/features/administration/api";
import type { PosCustomer } from "./types";

export interface PosCustomerSearchPage {
  customers: PosCustomer[];
  nextCursor: string | null;
  scanned: number;
  scanLimited: boolean;
  complete: boolean;
}

export function normalizeCustomerSearch(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function uniqueCustomers(customers: PosCustomer[]) {
  return [...new Map(customers.map(customer => [customer.id, customer])).values()]
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")) || String(a.customerNumber ?? a.id).localeCompare(String(b.customerNumber ?? b.id)) || a.id.localeCompare(b.id));
}

export function PosCustomerSelector({ customers, customerId, branchId, scopeKey, online, disabled = false, onSelect }: {
  customers: PosCustomer[]; customerId: string; branchId: string; scopeKey: string;
  online: boolean; disabled?: boolean; onSelect: (customer: PosCustomer | null) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const options = useRef(new Map<string, HTMLDivElement>());
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>();
  const [text, setText] = useState("");
  const query = normalizeCustomerSearch(text);
  const key = JSON.stringify([scopeKey, branchId, query, online]);
  const [paging, setPaging] = useState<{ key: string; cursor: string }>();
  const [retry, setRetry] = useState(0);
  const cursor = paging?.key === key ? paging.cursor : undefined;
  const requestKey = JSON.stringify([key, cursor, retry]);
  const [response, setResponse] = useState<(PosCustomerSearchPage & { key: string; requestKey: string; error?: string; hasPage: boolean })>();
  const enabled = online && Boolean(query) && !disabled;
  const current = response?.key === key ? response : undefined;
  const loading = enabled && current?.requestKey !== requestKey;
  const cached = useMemo(() => uniqueCustomers(customers.filter(customer => typeof customer.name === "string" && normalizeCustomerSearch(customer.name).includes(query))), [customers, query]);
  const matches = online && query && current?.hasPage ? current.customers : cached;
  const selected = customers.find(customer => customer.id === customerId);
  const choices = query ? matches : matches.slice(0, 8);
  const expanded = open && !disabled;
  const activeIndex = expanded ? choices.findIndex(customer => customer.id === activeId) : -1;
  const activeOptionId = activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;

  function edit(value: string) {
    setText(value); setPaging(undefined); setRetry(value => value + 1);
    setActiveId(undefined); setOpen(true);
  }

  function choose(customer: PosCustomer | null) {
    onSelect(customer);
    setText(""); setPaging(undefined); setRetry(value => value + 1);
    setActiveId(undefined); setOpen(false);
    changeButton.current?.focus();
  }

  useEffect(() => {
    if (!expanded) return;
    function dismiss(event: Event) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false); setActiveId(undefined);
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [expanded]);

  useEffect(() => {
    if (expanded && activeId) options.current.get(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [expanded, activeId]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void callAdministration<{ branchId: string; customerSearch: { query: string; cursor?: string; limit: number } }, PosCustomerSearchPage>(
        "getPosWorkspace", { branchId, customerSearch: { query, cursor, limit: 25 } },
      ).then(page => {
        if (!active) return;
        setResponse(previous => ({ ...page, key, requestKey, hasPage: true,
          customers: uniqueCustomers([...(cursor && previous?.key === key ? previous.customers : []), ...page.customers]),
          scanned: page.scanned + (cursor && previous?.key === key ? previous.scanned : 0),
        }));
      }).catch(() => {
        if (!active) return;
        setResponse(previous => ({ customers: [], nextCursor: null, scanned: 0, scanLimited: false, complete: false, hasPage: false,
          ...(previous?.key === key ? previous : {}), key, requestKey,
          error: "Customer search could not finish. Retry or reconnect; your selected customer and cart are unchanged.",
        }));
      });
    }, cursor ? 0 : 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [enabled, branchId, query, cursor, key, requestKey]);

  const status = disabled ? "Search is paused while POS is busy."
    : !online ? "Offline: cached customers only. Reconnect to search everyone."
    : !query ? "Start with any part of a name. Suggestions appear as you type."
    : loading ? "Searching customer names…"
    : current?.error ? "Search incomplete. Your selected customer is unchanged."
    : current?.nextCursor ? `${matches.length} matches loaded. Continue to check more customers.`
    : current?.complete ? matches.length ? `${matches.length} matching customers.` : "No matching active customers. Try another part of the name."
    : "Start with any part of a name.";

  return <div ref={root} className={styles.selector}>
    <label htmlFor={`${id}-input`} className={styles.label}>Search customer name</label>
    <div className={styles.field}>
      <Search size={18} aria-hidden="true" />
      <input ref={input} id={`${id}-input`} role="combobox" type="text" autoComplete="off" spellCheck={false}
        maxLength={160} value={text} disabled={disabled} placeholder="Start typing a name…"
        aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-list` : undefined}
        aria-activedescendant={activeOptionId} aria-describedby={`${id}-status`}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={event => edit(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            if (choices.length) {
              const next = event.key === "ArrowDown" ? Math.min(activeIndex + 1, choices.length - 1) : activeIndex < 0 ? choices.length - 1 : Math.max(activeIndex - 1, 0);
              setActiveId(choices[next]?.id);
            }
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (expanded && activeIndex >= 0) choose(choices[activeIndex]!);
          } else if (event.key === "Escape" && expanded) {
            event.preventDefault(); event.stopPropagation(); setOpen(false); setActiveId(undefined);
          }
        }} />
      {text && <button type="button" className={styles.clear} aria-label="Clear customer search" disabled={disabled}
        onMouseDown={event => event.preventDefault()} onClick={() => { edit(""); input.current?.focus(); }}><X size={18} aria-hidden="true" /></button>}
    </div>
    <p id={`${id}-status`} role="status" className={styles.status}>{status}</p>
    {expanded && <div className={styles.suggestions}>
      <div className={styles.caption}>{query ? "Matching customers" : "Loaded customers"}<span>Choose a name below</span></div>
      <div id={`${id}-list`} role="listbox" aria-label={query ? "Matching customers" : "Loaded customers"} className={styles.list}>
        {choices.map((customer, index) => <div key={customer.id} id={`${id}-option-${index}`} role="option"
          aria-selected={customer.id === customerId} data-active={customer.id === activeId || undefined}
          className={styles.option} ref={element => { if (element) options.current.set(customer.id, element); else options.current.delete(customer.id); }}
          onMouseDown={event => event.preventDefault()} onMouseMove={() => setActiveId(customer.id)} onClick={() => choose(customer)}>
          <span className={styles.identity}><span className={styles.name}><FinancialText>{customer.name}</FinancialText></span>
            <span className={styles.number}><FinancialText>{customer.customerNumber || customer.id}</FinancialText></span></span>
          {customer.id === customerId && <Check size={18} aria-hidden="true" className={styles.check} />}
        </div>)}
      </div>
      {!choices.length && <p className={styles.empty}>{loading ? "Looking for customers…" : current?.error ? "Retry the search below to check the directory." : current?.nextCursor ? "No matches in this batch. Continue searching below." : query ? "Try a different part of the name." : "Type a name to find a customer."}</p>}
      {!query && matches.length > choices.length && <p className={styles.empty}>Type to narrow {matches.length} loaded customers.</p>}
    </div>}
    {current?.error && !loading && <div className={styles.feedback}><p role="alert">{current.error}</p><Button type="button" size="sm" variant="outline" disabled={!enabled} onClick={() => { setOpen(true); setPaging(undefined); setRetry(value => value + 1); }}>Retry customer search</Button></div>}
    {current?.nextCursor && <Button type="button" size="sm" variant="outline" disabled={!enabled || loading} onClick={() => { if (current.nextCursor) { setOpen(true); setActiveId(undefined); setPaging({ key, cursor: current.nextCursor }); } }}>Continue customer search</Button>}
    <div className={styles.selection} aria-label="Selected customer">
      <UserRound size={18} aria-hidden="true" />
      <div className={styles.identity}><span className={styles.selectionLabel}>{customerId ? "Selected customer" : "Current sale"}</span>
        <span className={styles.name}><FinancialText>{customerId ? selected?.name ?? "Selected customer (refresh to verify)" : "Walk-in customer"}</FinancialText></span>
        {customerId && <span className={styles.number}><FinancialText>{selected?.customerNumber || customerId}</FinancialText></span>}
      </div>
      <button ref={changeButton} type="button" className={styles.change} disabled={disabled} onClick={() => { edit(""); input.current?.focus(); }}>Change<span className="sr-only"> customer</span></button>
    </div>
    {customerId && <button type="button" className={styles.walkIn} disabled={disabled} onClick={() => choose(null)}>Use walk-in customer</button>}
  </div>;
}
