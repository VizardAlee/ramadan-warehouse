"use client";

import { forwardRef, useEffect, useId, useRef, useState, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { matchesProductName } from "@/features/products/name-search";

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Names only. Never pass SKU, identifiers, lot numbers or financial details. */
  itemNames: Record<string, string>;
  scopeKey?: string;
  loading?: boolean;
};
type Choice = { index: number; value: string; name: string; searchName: string; detail: string; disabled: boolean };
type Picker = { stamp: string; choices: Choice[]; label: string; left: number; top: number; width: number; viewportHeight: number; viewportTop: number };

/**
 * Keep the real select visible, focusable and registered with the form. Its
 * validation, native reset, disabled fieldset, ref and change events still work.
 * Only the picker is enhanced; typing and dismissing never change its value.
 */
export const SearchableItemSelect = forwardRef<HTMLSelectElement, Props>(function SearchableItemSelect(
  { itemNames, scopeKey = "", loading = false, children, onKeyDown, onMouseDown, onPointerDown, onClick, ...props }, forwardedRef,
) {
  const select = useRef<HTMLSelectElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const stamp = JSON.stringify([scopeKey, props.value, props.disabled, loading, itemNames]);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Returning to an old scope must not reopen its dismissed picker.
  if (picker && picker.stamp !== stamp) setPicker(null);
  const opened = picker !== null && picker.stamp === stamp && !props.disabled && !loading;
  const matches = (picker?.choices ?? []).filter(choice => !query.trim() || (choice.value !== "" && matchesProductName(choice.searchName, query)));
  const enabled = matches.filter(choice => !choice.disabled);
  const current = enabled[Math.min(active, Math.max(0, enabled.length - 1))];

  function close(restore = false) {
    setPicker(null);
    if (restore) select.current?.focus();
  }
  function open(initialQuery = "") {
    const control = select.current;
    if (!control || control.matches(":disabled") || loading) return;
    const bounds = control.getBoundingClientRect();
    const choices = Array.from(control.options).map((option, index) => {
      // Read rendered text: masked financial details must never be reconstructed.
      const text = option.textContent?.trim().replace(/\s+/g, " ") ?? "";
      const rawName = itemNames[option.value]?.trim().replace(/\s+/g, " ");
      const visibleName = Boolean(rawName && text.startsWith(rawName));
      return { index, value: option.value, name: visibleName ? rawName! : text, searchName: visibleName ? rawName! : "", detail: visibleName ? text.slice(rawName!.length).trim().replace(/^[·—]\s*/, "") : "", disabled: option.disabled };
    });
    const label = props["aria-label"] ?? (Array.from(control.labels ?? []).map(label => {
      const clone = label.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("select, input, button").forEach(node => node.remove());
      return clone.textContent?.trim();
    }).join(" ") || "Item");
    const width = Math.min(Math.max(bounds.width, 260), window.innerWidth - 16);
    setQuery(initialQuery);
    setActive(initialQuery ? 0 : Math.max(0, choices.filter(choice => !choice.disabled).findIndex(choice => choice.index === control.selectedIndex)));
    setPicker({ stamp, choices, label, left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)), top: bounds.bottom, width, viewportTop: window.visualViewport?.offsetTop ?? 0, viewportHeight: window.visualViewport?.height ?? window.innerHeight });
  }
  function choose(choice: Choice) {
    const control = select.current;
    if (!control || control.matches(":disabled") || choice.disabled) return;
    control.selectedIndex = choice.index;
    control.dispatchEvent(new Event("change", { bubbles: true }));
    close(true);
  }
  useEffect(() => {
    if (!opened) return;
    search.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && event.target !== select.current) setPicker(null);
    };
    const dismissPicker = () => setPicker(null);
    // Keep the picker open when the on-screen keyboard changes viewport height.
    const resize = () => {
      const bounds = select.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(Math.max(bounds.width, 260), window.innerWidth - 16);
      setPicker(previous => previous ? { ...previous, top: bounds.bottom, left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)), width, viewportTop: window.visualViewport?.offsetTop ?? 0, viewportHeight: window.visualViewport?.height ?? window.innerHeight } : null);
    };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) resize(); };
    // Options/permissions/privacy may change while open. Never keep stale choices.
    const observer = new MutationObserver(dismissPicker);
    if (select.current) {
      observer.observe(select.current, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled"] });
      let ancestor = select.current.parentElement;
      while (ancestor) {
        if (ancestor.tagName === "FIELDSET") observer.observe(ancestor, { attributes: true, attributeFilter: ["disabled"] });
        ancestor = ancestor.parentElement;
      }
    }
    const form = select.current?.form;
    form?.addEventListener("reset", dismissPicker);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    window.addEventListener("scroll", scroll, true);
    return () => {
      observer.disconnect();
      form?.removeEventListener("reset", dismissPicker);
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [opened]);
  useEffect(() => {
    if (opened && current) document.getElementById(`${id}-option-${current.index}`)?.scrollIntoView?.({ block: "nearest" });
  }, [opened, current, id]);

  return <>
    <select {...props} disabled={props.disabled || loading} ref={node => {
      select.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }} aria-expanded={opened} aria-controls={opened ? `${id}-list` : undefined} aria-busy={loading || undefined}
      onPointerDown={event => { onPointerDown?.(event); if (!event.defaultPrevented && event.button === 0) event.preventDefault(); }}
      onMouseDown={event => { onMouseDown?.(event); if (!event.defaultPrevented && event.button === 0) event.preventDefault(); }}
      onClick={event => { onClick?.(event); if (!event.defaultPrevented) { if (opened) close(true); else open(); } }}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (["ArrowDown", "ArrowUp", "Enter", " ", "F4"].includes(event.key) || (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)) {
          event.preventDefault(); open(event.key.length === 1 && event.key !== " " ? event.key : "");
        }
      }}>{children}</select>
    {opened && picker && createPortal(
      <div ref={popup} className="fixed z-[100] overflow-y-auto rounded-lg border bg-[var(--surface,#fff)] p-2 shadow-xl" style={{ left: picker.left, top: Math.max(picker.viewportTop + 8, Math.min(picker.top, picker.viewportTop + picker.viewportHeight - 320)), width: picker.width, maxHeight: Math.max(120, picker.viewportHeight - 16) }}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
          else if (event.key === "Tab") { close(); select.current?.focus(); }
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(value => enabled.length ? (value + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length : 0); }
          else if (event.key === "Home" && event.ctrlKey) { event.preventDefault(); setActive(0); }
          else if (event.key === "End" && event.ctrlKey) { event.preventDefault(); setActive(Math.max(0, enabled.length - 1)); }
          else if (event.key === "Enter") { event.preventDefault(); if (current) choose(current); }
        }}>
        <input ref={search} type="search" role="combobox" aria-label={`Search ${picker.label} by item name`} aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-list`} aria-activedescendant={current ? `${id}-option-${current.index}` : undefined} placeholder="Search by item name…" className="min-h-11 w-full rounded-md border p-2" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} />
        <div id={`${id}-list`} role="listbox" aria-label={picker.label} className="mt-2 max-h-56 overflow-y-auto">
          {matches.map(choice => <div key={choice.index} id={`${id}-option-${choice.index}`} role="option" aria-selected={choice.value === select.current?.value} aria-disabled={choice.disabled || undefined}
            className={`min-h-11 cursor-pointer rounded p-2 ${current?.index === choice.index ? "bg-blue-50 text-slate-950 outline outline-1 outline-blue-500" : ""} ${choice.disabled ? "cursor-not-allowed opacity-50" : ""}`}
            onPointerDown={event => event.preventDefault()} onClick={() => choose(choice)}>
            <span className="block">{choice.name}</span>{choice.detail && <span className="block text-xs">{choice.detail}</span>}
          </div>)}
          {!matches.some(choice => choice.value !== "") && <p role="status" className="p-3 text-sm">{query.trim() ? "No items match this name." : "No items available."}</p>}
        </div>
      </div>, select.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body,
    )}
  </>;
});
