// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MoneyTenderEditor, parseMoneyTenders, type MoneyTenderDraft } from "@/features/finance/money-tender-editor";
afterEach(cleanup);
it("requires exact kobo across multiple actual accounts and detects repeated receipts", () => {
  const first: MoneyTenderDraft = { id: "1", method: "cash", amount: "33.33", bankAccountId: "", reference: "" };
  const second: MoneyTenderDraft = { id: "2", method: "bank_transfer", amount: "66.68", bankAccountId: "bank", reference: "BANK-1" };
  expect(parseMoneyTenders([first, second], 10001).error).toBeNull();
  expect(parseMoneyTenders([first, { ...second, amount: "66.67" }], 10001).error).toMatch(/exactly/);
  expect(parseMoneyTenders([second, second], 13336).error).toMatch(/repeat/);
  expect(parseMoneyTenders([{ ...first, amount: "0.001" }], 1).error).toBeTruthy();
  function Harness() { const [value, setValue] = useState([first]); return <MoneyTenderEditor value={value} onChange={setValue} total={10001} banks={[{ id: "bank", bankName: "Bank", accountName: "Operating", accountNumberLast4: "1234" }]} />; }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Add payment part" }));
  fireEvent.change(screen.getByLabelText("Part 2 method"), { target: { value: "bank_transfer" } });
  fireEvent.change(screen.getByLabelText("Part 2 amount"), { target: { value: "66.68" } });
  fireEvent.change(screen.getByLabelText("Part 2 account"), { target: { value: "bank" } });
  fireEvent.change(screen.getByLabelText("Part 2 reference"), { target: { value: "BANK-1" } });
  expect(screen.getByRole("status").textContent).toContain("matched exactly");
});
