// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { AmountInput } from "@/components/ui/amount-input";
import { amountCaretPosition, formatAmountInput, isNumberAmountDraft, parsePastedAmount } from "@/lib/amount-input";
import { nairaToKobo } from "@/features/inventory/format";

afterEach(cleanup);
function Harness({ initial = "", ...props }: Omit<Parameters<typeof AmountInput>[0], "value" | "onValueChange"> & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><AmountInput aria-label="Amount" {...props} value={value} onValueChange={setValue} /><output data-testid="raw">{value}</output><button onClick={() => setValue("9876543.21")}>Reset</button></>;
}
function input() { return screen.getByLabelText("Amount") as HTMLInputElement; }
function edit(text: string, caret = text.length) { fireEvent.change(input(), { target: { value: text, selectionStart: caret, selectionEnd: caret } }); }
function paste(text: string) { fireEvent.paste(input(), { clipboardData: { getData: () => text } }); }

describe("lossless amount display", () => {
  it.each([
    ["", ""], ["0", "0"], ["0.00", "0.00"], ["1234", "1,234"], ["12345678901234567890.0010", "12,345,678,901,234,567,890.0010"],
    ["-1234567.50", "-1,234,567.50"], ["1234.", "1,234."], [".50", ".50"], ["-", "-"], ["0000123.40", "0,000,123.40"], ["1e3", "1e3"],
  ])("groups %s without altering its digits", (raw, formatted) => expect(formatAmountInput(raw)).toBe(formatted));
  it.each([["1,234,567.50", "1234567.50"], [" -1,234.00 ", "-1234.00"], ["1234.", "1234."], [".50", ".50"], ["1e3", "1e3"]])("accepts unambiguous paste %s", (text, raw) => expect(parsePastedAmount(text)).toBe(raw));
  it.each(["1.234,56", "1234,56", "12,34", "1,23,456", "1,234.5.6", "₦1,234", "1 234", "hello"])("never reinterprets ambiguous paste %s", text => expect(parsePastedAmount(text)).toBeNull());
  it.each(["", "-", ".", "-.", "1234.", "-1234.50", "1e", "1e-", "1.2e+3"])("allows legitimate numeric draft %s", value => expect(isNumberAmountDraft(value)).toBe(true));
  it.each(["0x10", "0b10", "0o10", " ", "123 456", "Infinity", "NaN", "1.e3", "1e3.", "+1234", "abc"])("rejects non-native numeric syntax %s", value => expect(isNumberAmountDraft(value)).toBe(false));
  it("maps both sides of an existing separator", () => {
    expect(amountCaretPosition("1,234", 1, "1,234")).toBe(1);
    expect(amountCaretPosition("1,234", 2, "1,234")).toBe(2);
  });
});

describe("editing", () => {
  it("displays commas while keeping canonical strings and kobo unchanged", () => {
    render(<Harness initial="1234567.50" type="number" step="0.01" />);
    expect(input().value).toBe("1,234,567.50");
    input().focus(); edit("9876543.21");
    expect(input().value).toBe("9,876,543.21");
    expect(screen.getByTestId("raw").textContent).toBe("9876543.21");
    expect(nairaToKobo(Number(screen.getByTestId("raw").textContent))).toBe(987654321);
    expect(input().selectionStart).toBe(12);
    expect(input().inputMode).toBe("decimal");
  });
  it("keeps incomplete, zero and negative drafts without rounding", () => {
    render(<Harness type="number" step="0.01" />);
    for (const text of ["0", "0.", "0.00", "-", "-1234.", "-1234.50", "1234.567", ""]) {
      edit(text); expect(input().value).toBe(formatAmountInput(text)); expect(screen.getByTestId("raw").textContent).toBe(text);
    }
  });
  it("never forwards hex, binary, whitespace or invalid exponent syntax from former number fields", () => {
    render(<Harness type="number" />);
    for (const text of ["0x10", "0b10", "0o10", " ", "123 456", "Infinity", "NaN", "1.e3", "1e3.", "+1234", "abc"]) {
      edit(text); fireEvent.blur(input()); expect(input().value).toBe(""); expect(screen.getByTestId("raw").textContent).toBe("");
    }
  });
  it("does not restore a stale caret after a same-raw separator edit", () => {
    const { rerender } = render(<Harness initial="1234" />); input().focus(); edit("1234", 1); input().setSelectionRange(5, 5);
    rerender(<Harness initial="1234" aria-describedby="new-help" />); expect(input().selectionStart).toBe(5);
  });
  it("preserves middle insertion, selected replacement and decimal caret", () => {
    render(<Harness initial="12345.67" />); input().focus();
    edit("12,9345.67", 4); expect(input().value).toBe("129,345.67"); expect(input().selectionStart).toBe(3);
    input().setSelectionRange(0, 3); paste("8"); expect(input().value).toBe("8,345.67"); expect(input().selectionStart).toBe(1);
    edit("8,345.967", 7); expect(input().selectionStart).toBe(7);
  });
  it("makes backward and forward deletion at separators remove the adjacent digit", () => {
    render(<Harness initial="12345" />); input().focus(); input().setSelectionRange(3, 3);
    fireEvent.keyDown(input(), { key: "Backspace" }); expect(input().value).toBe("1,345"); expect(input().selectionStart).toBe(1);
    input().setSelectionRange(1, 1); fireEvent.keyDown(input(), { key: "Delete" }); expect(input().value).toBe("145"); expect(input().selectionStart).toBe(1);
  });
  it("handles touch-keyboard deletion and refuses decimal-comma typing", () => {
    render(<Harness initial="12345" />); input().focus();
    fireEvent.input(input(), { target: { value: "12345", selectionStart: 2, selectionEnd: 2 }, inputType: "deleteContentBackward" });
    expect(input().value).toBe("1,345"); expect(input().selectionStart).toBe(1);
    fireEvent.input(input(), { target: { value: "1345", selectionStart: 1, selectionEnd: 1 }, inputType: "deleteContentForward" });
    expect(input().value).toBe("145");
    fireEvent.input(input(), { target: { value: "145,", selectionStart: 4, selectionEnd: 4 }, inputType: "insertText", data: "," });
    expect(input().value).toBe("145"); expect(screen.getByTestId("raw").textContent).toBe("145");
  });
  it("does not change read-only or disabled values through custom editing handlers", () => {
    const { rerender } = render(<Harness initial="1234" readOnly />); input().focus(); input().setSelectionRange(2, 2);
    fireEvent.keyDown(input(), { key: "Backspace" }); expect(input().value).toBe("1,234");
    input().select(); paste("5000"); expect(input().value).toBe("1,234");
    rerender(<Harness initial="1234" disabled />); paste("5000"); expect(input().value).toBe("1,234");
  });
  it("preserves a selected range and allows whole-input clearing", () => {
    render(<Harness initial="1234567" />); input().focus();
    fireEvent.change(input(), { target: { value: "1234567", selectionStart: 1, selectionEnd: 6, selectionDirection: "backward" } });
    expect(input().value).toBe("1,234,567"); expect(input().selectionStart).toBe(1); expect(input().selectionEnd).toBe(8); expect(input().selectionDirection).toBe("backward");
    edit(""); expect(input().value).toBe("");
  });
  it("accepts formatted paste, rejects locale ambiguity and updates external values", () => {
    render(<Harness />); input().focus(); paste("1,234,567.50"); expect(screen.getByTestId("raw").textContent).toBe("1234567.50");
    input().select(); paste("1.234,56"); expect(input().value).toBe("1,234,567.50");
    fireEvent.click(screen.getByText("Reset")); expect(input().value).toBe("9,876,543.21");
  });
  it("counts maxLength on raw digits, not inserted commas", () => {
    render(<Harness maxLength={7} />); edit("1234567"); expect(input().value).toBe("1,234,567");
    edit("12345678"); expect(input().value).toBe("1,234,567");
  });
  it("defers formatting during composition and commits only unambiguous amounts", () => {
    render(<Harness initial="1" />); input().focus();
    fireEvent.compositionStart(input()); edit("1234"); expect(input().value).toBe("1234"); expect(screen.getByTestId("raw").textContent).toBe("1");
    fireEvent.compositionEnd(input()); expect(input().value).toBe("1,234"); expect(screen.getByTestId("raw").textContent).toBe("1234");
  });
});

describe("validation and form integration", () => {
  it("keeps required, min, max and exact decimal step validation on the visible field", () => {
    render(<Harness type="number" min="0.01" max="5000" step="0.01" required aria-describedby="help" />);
    expect(input().checkValidity()).toBe(false);
    for (const value of ["-1", "0", "5000.01", "1234.567", "-", ".", "1e"]) { edit(value); expect(input().checkValidity(), value).toBe(false); }
    for (const value of ["0.01", "1234.50", "5000", "1234."]) { edit(value); expect(input().checkValidity(), value).toBe(true); }
    expect(input().getAttribute("aria-describedby")).toBe("help");
  });
  it("retains negative-bank-balances, any-step text fields and disabled/read-only behavior", () => {
    const { rerender } = render(<Harness type="number" step="0.01" initial="-1234.50" />);
    expect(input().checkValidity()).toBe(true);
    rerender(<Harness initial="-1234.50" />); edit("1234.567"); expect(input().checkValidity()).toBe(true);
    rerender(<Harness disabled readOnly />); expect(input().disabled).toBe(true); expect(input().readOnly).toBe(true);
  });
  it("keeps fractional step bases rather than rounding to two places", () => {
    render(<Harness type="number" min="0.005" step="0.01" />); edit("1000.005"); expect(input().checkValidity()).toBe(true); edit("1000.01"); expect(input().checkValidity()).toBe(false);
  });
  it("keeps RHF numeric values, validation, reset, focus and optional-empty contracts", async () => {
    const submitted = vi.fn();
    function Form() {
      const form = useForm<{ amount?: number }>({ defaultValues: { amount: 1234.5 } });
      return <form onSubmit={form.handleSubmit(submitted)}><Controller control={form.control} name="amount" render={({ field }) => <AmountInput aria-label="Amount" type="number" step="0.01" name={field.name} ref={field.ref} onBlur={field.onBlur} value={field.value} onValueChange={value => field.onChange(value === "" ? undefined : Number(value))} />} /><button type="submit">Save</button><button type="button" onClick={() => form.reset({ amount: 9876.54 })}>Clear form</button><button type="button" onClick={() => form.setFocus("amount")}>Focus amount</button></form>;
    }
    render(<Form />); expect(input().value).toBe("1,234.5");
    for (const text of ["0x10", "0b10", " "]) { edit(text); fireEvent.blur(input()); expect(input().value).toBe("1,234.5"); }
    edit("-"); fireEvent.blur(input()); expect(input().value).toBe("-"); expect(input().checkValidity()).toBe(false);
    input().focus(); edit("1234."); expect(input().value).toBe("1,234."); edit("1234.00"); expect(input().value).toBe("1,234.00");
    fireEvent.click(screen.getByText("Save")); await waitFor(() => expect(submitted.mock.calls[0]?.[0]).toEqual({ amount: 1234 }));
    fireEvent.click(screen.getByText("Clear form")); expect(input().value).toBe("9,876.54");
    fireEvent.click(screen.getByText("Focus amount")); expect(document.activeElement).toBe(input());
    edit(""); fireEvent.click(screen.getByText("Save")); await waitFor(() => expect(submitted.mock.calls[1]?.[0]).toEqual({ amount: undefined }));
  });
});
