"use client";

import { useLayoutEffect, useRef, useState, type ComponentPropsWithRef } from "react";
import { amountCaretPosition, formatAmountInput, isNumberAmountDraft, parsePastedAmount, ungroupAmountInput } from "@/lib/amount-input";

type Props = Omit<ComponentPropsWithRef<"input">, "value" | "defaultValue" | "onChange" | "type"> & {
  value?: string | number;
  onValueChange: (value: string) => void;
  /** Retains the former input's native numeric min/max/step validation. */
  type?: "number" | "text";
};

/** Commas belong only to the display. Callers retain their existing raw-value parsers. */
export function AmountInput({ value, onValueChange, type = "text", ref, min, max, step, required,
  maxLength, onBlur, onKeyDown, onPaste, onDrop, onCompositionStart, onCompositionEnd, ...props }: Props) {
  const input = useRef<HTMLInputElement | null>(null);
  const selection = useRef<{ start: number; end: number; direction: "forward" | "backward" | "none" } | null>(null);
  const composing = useRef(false);
  const [draft, setDraft] = useState<{ text: string } | null>(null);
  const [composition, setComposition] = useState<string | null>(null);
  // Numeric RHF fields can echo 1234 for an in-progress "1234." or "1234.00".
  const draftMatches = draft !== null && (typeof value === "number" ? Object.is(Number(draft.text), value) : draft.text === (value ?? ""));
  const raw = draftMatches ? draft.text : String(value ?? "");
  const formatted = composition ?? formatAmountInput(raw);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    // A text input is needed for grouping/caret APIs. Ask a detached native number
    // input to apply the original constraints, including fractional step bases.
    const validator = document.createElement("input");
    validator.type = type;
    if (min !== undefined) validator.min = String(min);
    if (max !== undefined) validator.max = String(max);
    if (step !== undefined) validator.step = String(step);
    validator.required = Boolean(required);
    validator.value = /^[+-]?\d+\.$/.test(raw) ? raw.slice(0, -1) : raw;
    const invalidNumber = type === "number" && raw !== "" && validator.value === "";
    element.setCustomValidity(invalidNumber ? "Enter a valid number." : validator.validationMessage);
    if (selection.current && document.activeElement === element) {
      const { start, end, direction } = selection.current;
      element.setSelectionRange(start, end, direction);
    }
    selection.current = null;
  });

  function change(text: string, start: number, end = start, direction: "forward" | "backward" | "none" = "none") {
    if (props.disabled || props.readOnly || input.current?.matches(":disabled")) return;
    const next = ungroupAmountInput(text);
    if (type === "number" && !isNumberAmountDraft(next)) return;
    if (maxLength !== undefined && next.length > maxLength) return;
    const display = formatAmountInput(next);
    selection.current = { start: amountCaretPosition(text, start, display), end: amountCaretPosition(text, end, display), direction };
    setDraft({ text: next });
    onValueChange(next);
    // Also covers edits that only remove a separator and don't change parent state.
    if (input.current) {
      input.current.value = display;
      input.current.setSelectionRange(selection.current.start, selection.current.end, direction);
    }
  }

  function insert(text: string) {
    const element = input.current;
    if (!element) return;
    const start = element.selectionStart ?? 0, end = element.selectionEnd ?? start;
    change(element.value.slice(0, start) + text + element.value.slice(end), start + text.length);
  }

  return <input {...props} type="text" inputMode={props.inputMode ?? "decimal"} min={min} max={max} step={step} required={required}
    ref={element => {
      input.current = element;
      if (typeof ref === "function") return ref(element);
      if (ref) ref.current = element;
    }} value={formatted}
    onChange={event => {
      if (composing.current) { setComposition(event.target.value); return; }
      const native = event.nativeEvent as InputEvent;
      if (native.data === ",") return;
      if ((native.inputType === "insertReplacementText" || native.inputType === "insertFromPaste") && parsePastedAmount(event.target.value) === null) return;
      const text = event.target.value, caret = event.target.selectionStart ?? text.length;
      // Touch keyboards may send input events without a preceding keydown.
      if (text.length === formatted.length - 1 && ungroupAmountInput(text) === raw && formatted[caret] === ",") {
        if (native.inputType === "deleteContentBackward") { change(text.slice(0, caret - 1) + text.slice(caret), Math.max(0, caret - 1)); return; }
        if (native.inputType === "deleteContentForward") { change(text.slice(0, caret) + text.slice(caret + 1), caret); return; }
      }
      change(event.target.value, event.target.selectionStart ?? event.target.value.length, event.target.selectionEnd ?? event.target.value.length, event.target.selectionDirection ?? "none");
    }}
    onBlur={event => { if (typeof value !== "number" || Number.isFinite(value)) setDraft(null); onBlur?.(event); }}
    onKeyDown={event => {
      onKeyDown?.(event);
      if (event.defaultPrevented || composing.current || event.ctrlKey || event.metaKey || event.altKey) return;
      const element = event.currentTarget, start = element.selectionStart ?? 0, end = element.selectionEnd ?? start;
      // A manually typed comma is not a decimal separator. Grouping is automatic.
      if (event.key === ",") { event.preventDefault(); return; }
      if (start !== end) return;
      // Backspace/Delete beside an automatic comma deletes the adjacent digit,
      // rather than repeatedly restoring the separator and trapping the caret.
      if (event.key === "Backspace" && element.value[start - 1] === ",") {
        event.preventDefault(); change(element.value.slice(0, start - 2) + element.value.slice(start), Math.max(0, start - 2));
      } else if (event.key === "Delete" && element.value[start] === ",") {
        event.preventDefault(); change(element.value.slice(0, start) + element.value.slice(start + 2), start);
      }
    }}
    onPaste={event => {
      onPaste?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      const pasted = parsePastedAmount(event.clipboardData.getData("text"));
      if (pasted !== null) insert(pasted);
    }}
    onDrop={event => {
      onDrop?.(event);
      if (event.defaultPrevented) return;
      // Dropping can move the browser caret unpredictably; keep the current value.
      event.preventDefault();
    }}
    onCompositionStart={event => { composing.current = true; onCompositionStart?.(event); }}
    onCompositionEnd={event => {
      composing.current = false; setComposition(null);
      const text = event.currentTarget.value;
      const parsed = parsePastedAmount(text);
      if (parsed !== null || text === "") change(text, event.currentTarget.selectionStart ?? text.length);
      onCompositionEnd?.(event);
    }} />;
}
