"use client";

import { useEffect, useMemo, useState } from "react";
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
  const choices = matches.filter(customer => customer.id !== customerId);

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

  return <div className="min-w-0 flex-1 space-y-2">
    <label className="block text-sm font-medium">Search customer name
      <input type="search" className="mt-1 w-full min-w-0 rounded-lg border p-3" maxLength={160}
        value={text} disabled={disabled} placeholder="Type part of a customer name"
        aria-describedby="pos-customer-search-status" onChange={event => { setText(event.target.value); setPaging(undefined); setRetry(value => value + 1); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); setPaging(undefined); setRetry(value => value + 1); } }} />
    </label>
    <label className="block text-sm font-medium">Customer
      <select className="mt-1 w-full min-w-0 rounded-lg border p-3" value={customerId} disabled={disabled}
        onChange={event => {
          const id = event.target.value;
          if (!id) onSelect(null);
          else { const customer = [selected, ...matches].find(item => item?.id === id); if (customer) onSelect(customer); }
        }}>
        <option value="">Walk-in customer</option>
        {customerId && <optgroup label="Current selection">
          <option value={customerId}><FinancialText>{selected?.name ?? "Selected customer (refresh to verify)"}</FinancialText> · <FinancialText>{selected?.customerNumber ?? customerId}</FinancialText></option>
        </optgroup>}
        {choices.length > 0 && <optgroup label={query ? "Matching customers" : "Loaded customers"}>
          {choices.map(customer => <option key={customer.id} value={customer.id}><FinancialText>{customer.name}</FinancialText> · <FinancialText>{customer.customerNumber}</FinancialText></option>)}
        </optgroup>}
      </select>
    </label>
    <p id="pos-customer-search-status" role="status" className="break-words text-xs text-[var(--muted)]">
      {!online ? "Offline: searching cached customers only. Reconnect to search all active customers."
        : !query ? "Type any part of a name to search all active customers. Customer numbers distinguish duplicate names."
        : loading ? "Searching customer names… Cached choices remain available."
        : current?.error ? "Search incomplete; the current selection is retained."
        : current?.nextCursor ? `${matches.length} matches loaded; more records may match. Continue customer search.`
        : current?.complete ? matches.length ? `${matches.length} matching customers.` : "No matching active customers. Try another part of the name."
        : "Search is paused while POS is busy."}
      {customerId && " Your selected customer is kept while you search."}
    </p>
    {current?.error && !loading && <><p role="alert" className="text-xs text-red-800">{current.error}</p><Button type="button" size="sm" variant="outline" disabled={!enabled} onClick={() => { setPaging(undefined); setRetry(value => value + 1); }}>Retry customer search</Button></>}
    {current?.nextCursor && <Button type="button" size="sm" variant="outline" disabled={!enabled || loading} onClick={() => { if (current.nextCursor) setPaging({ key, cursor: current.nextCursor }); }}>Continue customer search</Button>}
  </div>;
}
