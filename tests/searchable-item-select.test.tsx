// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { SearchableItemSelect } from "@/components/ui/searchable-item-select";

afterEach(cleanup);
const names = { panel: "Solar Panel", battery: "Battery", lot1: "Solar Panel", lot2: "Solar Panel" };
function Fixture({ scope = "one", disabled = false, loading = false }: { scope?: string; disabled?: boolean; loading?: boolean }) {
  const [value, setValue] = useState("battery");
  return <><label>Product<SearchableItemSelect required name="product" scopeKey={scope} disabled={disabled} loading={loading} itemNames={names} value={value} onChange={event => setValue(event.target.value)}>
    <option value="">Choose product</option>
    <option value="panel">Solar Panel</option>
    <option value="battery">Battery</option>
    <option value="lot1">Solar Panel · 3 available · Lot A</option>
    <option value="lot2" disabled>Solar Panel · 0 available · Lot B</option>
  </SearchableItemSelect></label><button>Next</button></>;
}
function open() { fireEvent.click(screen.getByLabelText("Product")); return screen.getByRole("combobox", { name: /Search Product/ }); }
it("searches names only, keeps the selection while typing, and restores focus after escape", () => {
  render(<Fixture />);
  const control = screen.getByLabelText("Product") as HTMLSelectElement;
  const search = open();
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: " solar   PANEL " } });
  expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(3);
  expect(control.value).toBe("battery");
  fireEvent.change(search, { target: { value: "Lot A" } });
  expect(screen.getByRole("status").textContent).toBe("No items match this name.");
  fireEvent.keyDown(search, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(control.value).toBe("battery");
  expect(document.activeElement).toBe(control);
  expect((open() as HTMLInputElement).value).toBe("");
});
it("supports keyboard selection, skips disabled options, and retains repeated names and stock details", () => {
  render(<Fixture />);
  const control = screen.getByLabelText("Product") as HTMLSelectElement;
  fireEvent.keyDown(control, { key: "ArrowDown" });
  const search = screen.getByRole("combobox", { name: /Search Product/ });
  fireEvent.change(search, { target: { value: "panel" } });
  fireEvent.keyDown(search, { key: "ArrowDown" });
  expect(search.getAttribute("aria-activedescendant")).toContain("option-3");
  fireEvent.keyDown(search, { key: "ArrowDown" });
  expect(search.getAttribute("aria-activedescendant")).toContain("option-1");
  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(control.value).toBe("lot1");
  expect(document.activeElement).toBe(control);
});
it("allows pointer selection without submitting and dismisses on outside pointer or scope change", () => {
  const view = render(<Fixture />);
  open();
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Solar Panel" }));
  expect((screen.getByLabelText("Product") as HTMLSelectElement).value).toBe("panel");
  open();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByRole("listbox")).toBeNull();
  open();
  view.rerender(<Fixture scope="two" />);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect((open() as HTMLInputElement).value).toBe("");
});
it("does not open while loading, disabled, or in a disabled fieldset", () => {
  const view = render(<Fixture disabled />);
  fireEvent.click(screen.getByLabelText("Product"));
  expect(screen.queryByRole("listbox")).toBeNull();
  view.rerender(<Fixture loading />);
  fireEvent.click(screen.getByLabelText("Product"));
  expect(screen.queryByRole("listbox")).toBeNull();
  view.rerender(<fieldset disabled><Fixture /></fieldset>);
  fireEvent.click(screen.getByLabelText("Product"));
  expect(screen.queryByRole("listbox")).toBeNull();
});
it("keeps required native validation focusable and emits real RHF change events", async () => {
  const submit = vi.fn();
  function Form() {
    const form = useForm({ defaultValues: { product: "" } });
    return <form onSubmit={form.handleSubmit(submit)}><label>Product<SearchableItemSelect required itemNames={names} {...form.register("product", { required: true })}>
      <option value="">Choose product</option><option value="panel">Solar Panel</option>
    </SearchableItemSelect></label><button type="submit">Save</button><button type="reset">Reset</button></form>;
  }
  render(<Form />);
  const control = screen.getByLabelText("Product") as HTMLSelectElement;
  expect(control.checkValidity()).toBe(false);
  control.focus();
  expect(document.activeElement).toBe(control);
  open();
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Solar Panel" }));
  expect(control.checkValidity()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith({ product: "panel" }, expect.anything()));
  open();
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.queryByRole("listbox")).toBeNull();
});
it("shows empty options and never reconstructs masked money from search metadata", async () => {
  const view = render(<label>Product<SearchableItemSelect itemNames={{}}><option value="">Choose product</option></SearchableItemSelect></label>);
  open();
  expect(screen.getByRole("status").textContent).toBe("No items available.");
  view.rerender(<label>Product<SearchableItemSelect itemNames={{ service: "Service" }}><option value="service">Service · •••• including configured VAT</option></SearchableItemSelect></label>);
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  open();
  expect(screen.getByRole("listbox").textContent).toContain("••••");
  expect(screen.getByRole("listbox").textContent).not.toMatch(/₦|5000/);
});
it("never reopens a stale scope and seeds printable-key searches", () => {
  const view = render(<Fixture />);
  fireEvent.keyDown(screen.getByLabelText("Product"), { key: "b" });
  expect((screen.getByRole("combobox", { name: /Search Product/ }) as HTMLInputElement).value).toBe("b");
  view.rerender(<Fixture scope="two" />);
  view.rerender(<Fixture scope="one" />);
  expect(screen.queryByRole("listbox")).toBeNull();
});
it("dismisses when an ancestor fieldset becomes disabled", async () => {
  const view = render(<fieldset><Fixture /></fieldset>);
  open();
  view.rerender(<fieldset disabled><Fixture /></fieldset>);
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
});
it("never searches availability or lot metadata when product names contain repeated whitespace", () => {
  render(<label>Product<SearchableItemSelect itemNames={{ lot: "Solar   Panel" }}><option value="lot">Solar   Panel · 12 available · Lot ABC</option></SearchableItemSelect></label>);
  const search = open();
  fireEvent.change(search, { target: { value: "solar panel" } });
  expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1);
  fireEvent.change(search, { target: { value: "ABC" } });
  expect(screen.getByRole("status").textContent).toBe("No items match this name.");
});
it("keeps a picker inside its dialog and treats Tab as dismissal", () => {
  render(<div role="dialog" aria-label="Edit stock"><Fixture /></div>);
  const search = open();
  expect(screen.getByRole("dialog").contains(search)).toBe(true);
  fireEvent.keyDown(search, { key: "Tab" });
  expect(screen.queryByRole("listbox")).toBeNull();
});
it("keeps search and selection intact when viewport height changes for an on-screen keyboard", () => {
  render(<Fixture />);
  const search = open();
  fireEvent.change(search, { target: { value: "panel" } });
  fireEvent(window, new Event("resize"));
  fireEvent(window, new Event("scroll"));
  expect(screen.getByRole("listbox")).toBeTruthy();
  expect((screen.getByRole("combobox", { name: /Search Product/ }) as HTMLInputElement).value).toBe("panel");
  expect((screen.getByRole("combobox", { name: "Product", exact: true }) as HTMLSelectElement).value).toBe("battery");
});
it("intercepts touch pointer-down without committing a selection", () => {
  render(<Fixture />);
  const control = screen.getByLabelText("Product");
  const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(event, "pointerType", { value: "touch" });
  expect(fireEvent(control, event)).toBe(false);
  expect((control as HTMLSelectElement).value).toBe("battery");
  fireEvent.click(control);
  expect(screen.getByRole("listbox")).toBeTruthy();
});
