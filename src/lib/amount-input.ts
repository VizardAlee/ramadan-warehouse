/** Display-only en-NG grouping. Never parses, rounds, or converts naira/kobo. */
export function formatAmountInput(value: string): string {
  return value.replace(/^([+-]?)(\d+)(?=\.|[eE]|$)/, (_, sign: string, integer: string) =>
    sign + integer.replace(/\B(?=(\d{3})+(?!\d))/g, ","),
  );
}

export function ungroupAmountInput(value: string): string {
  return value.replaceAll(",", "");
}

/** Pasted commas must be thousands groups, never an inferred decimal separator. */
export function parsePastedAmount(value: string): string | null {
  const text = value.trim();
  if (!/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  return ungroupAmountInput(text);
}

/** Preserve the logical character position when grouping inserts/removes commas. */
export function amountCaretPosition(text: string, position: number, formatted: string): number {
  const logical = ungroupAmountInput(text.slice(0, position)).length;
  let index = 0, seen = 0;
  while (index < formatted.length && seen < logical) {
    if (formatted[index] !== ",") seen++;
    index++;
  }
  if (text[position - 1] === "," && formatted[index] === ",") index++;
  return index;
}

/** Native number fields accept decimal/exponent drafts, not Number()'s hex or whitespace syntax. */
export function isNumberAmountDraft(value: string): boolean {
  return /^-?(?:(?:\d+(?:\.\d*)?|\.\d*)|(?:\d+(?:\.\d+)?|\.\d+)[eE][+-]?\d*)?$/.test(value);
}
