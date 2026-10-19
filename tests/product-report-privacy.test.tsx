// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinancialPrivacyProvider } from "@/features/finance/financial-privacy";
import { FinancialPrivacyToggle } from "@/features/finance/financial-privacy-toggle";
import { ProductPerformance } from "@/features/reports/product-performance";
import { ProductHistoryPreview } from "@/features/reports/product-history-preview";
import * as format from "@/features/inventory/format";
const api=vi.hoisted(()=>({call:vi.fn()}));vi.mock("@/features/administration/api",()=>({callAdministration:api.call}));
beforeEach(()=>{localStorage.clear();api.call.mockReset();});afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("masks currency-bearing report names, options and ARIA while preserving quantities and actual CSV payloads",async()=>{
 const name="Installation ₦25,000", sku="SKU-150";
 const profit={productId:"p",productName:name,sku,itemKind:"goods",invoicedQuantity:2,reversedQuantity:0,netSalesMinor:2500000,netRecordedCostMinor:1000000,grossMarginMinor:1500000,unknownCostLines:0,restockCreditMinor:0,invoicedNetMinor:2500000,reversedNetMinor:0,recordedCostMinor:1000000};
 const movement={...profit,unitOfMeasure:"piece",handedOverQuantity:7,restockedQuantity:1,includedPartsQuantity:0,netCustomerQuantity:6,unknownEntryCount:0,currentOnHandQuantity:10,activeLocalGoods:true};
 api.call.mockImplementation(async(name:string)=>name==="getProductMargins"?{rows:[profit],invoiceCount:1,completedAt:"2026-10-19T08:00:00Z"}:{rows:[movement],calendarDays:2,scannedEntries:1,unresolvedEntries:0,zeroPopulationIncluded:true,population:"Active local goods",completedAt:"2026-10-19T08:00:00Z"});
 const csv=vi.spyOn(format,"downloadCsv").mockImplementation(()=>{});
 const view=render(<FinancialPrivacyProvider organizationId="org" uid="u"><FinancialPrivacyToggle/><ProductPerformance branches={[]} products={[{id:"p",name,sku}]} canReadMargins canReadMovement canExportMovement/></FinancialPrivacyProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Calculate product margins"}));fireEvent.click(screen.getByRole("button",{name:"Calculate customer movement"}));
 await waitFor(()=>expect(screen.getAllByRole("article")).toHaveLength(2));
 expect(view.container.innerHTML).not.toContain("25,000"); expect(screen.getAllByText(/SKU-150/).length).toBeGreaterThan(0); expect(screen.getByText("7")).toBeTruthy();
 expect(screen.getAllByRole("article").every(article=>article.getAttribute("aria-label")==="Financial values hidden")).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"Export product CSV"}));fireEvent.click(screen.getByRole("button",{name:"Export movement CSV"}));
 expect(csv.mock.calls.every(([,rows])=>rows[0]?.product===name)).toBe(true);
 await waitFor(()=>expect(screen.getByRole("button",{name:"Hide financial values"}).getAttribute("disabled")).toBeNull());
 fireEvent.click(screen.getByRole("button",{name:"Hide financial values"}));expect(screen.getAllByRole("article",{name})).toHaveLength(2);
});
it("masks a currency-bearing history heading without hiding ordinary product names or stock quantities",async()=>{
 api.call.mockResolvedValue({rows:[]});
 const view=render(<FinancialPrivacyProvider organizationId="org" uid="u"><ProductHistoryPreview productId="p" productName="Installation ₦25,000" locations={{}} reportRow={{onHandQuantity:17}}/></FinancialPrivacyProvider>);
 expect(view.container.textContent).not.toContain("25,000");expect(screen.getByText("17")).toBeTruthy();await waitFor(()=>expect(screen.queryByText(/Loading recent activity/)).toBeNull());
 view.rerender(<FinancialPrivacyProvider organizationId="org" uid="u"><ProductHistoryPreview productId="q" productName="Ordinary inverter" locations={{}} reportRow={{onHandQuantity:17}}/></FinancialPrivacyProvider>);
 expect(screen.getByRole("heading",{name:"Ordinary inverter"})).toBeTruthy();
});
