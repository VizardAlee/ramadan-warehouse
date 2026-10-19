// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProductPerformance } from "@/features/reports/product-performance";
import { ProductMovement } from "@/features/reports/product-movement";
import * as format from "@/features/inventory/format";
const api=vi.hoisted(()=>({call:vi.fn()}));vi.mock("@/features/administration/api",()=>({callAdministration:api.call}));
afterEach(()=>{cleanup();vi.restoreAllMocks();api.call.mockReset();});
const movement={branchId:"a",fromDate:"2026-10-01",toDate:"2026-10-02",calendarDays:2,scannedEntries:2,unresolvedEntries:0,zeroPopulationIncluded:true,population:"Active local goods",startedAt:"2026-10-03T10:00:00Z",completedAt:"2026-10-03T10:01:00Z",rows:[{productId:"p",productName:"Panel",sku:"P",unitOfMeasure:"piece",handedOverQuantity:5,restockedQuantity:1,includedPartsQuantity:2,netCustomerQuantity:4,unknownEntryCount:0,entryCount:3,currentOnHandQuantity:0,activeLocalGoods:true}]};
it("shares product/Store/dates, clears exports after filter change, and respects access gates",async()=>{
 api.call.mockResolvedValue(movement);const download=vi.spyOn(format,"downloadCsv").mockImplementation(()=>{});
 render(<ProductPerformance branches={[{id:"a",name:"Store A"}]} products={[{id:"p",name:"Panel",sku:"P"}]} canReadMargins={false} canReadMovement canExportMovement />);
 expect(screen.queryByRole("button",{name:"Calculate product margins"})).toBeNull();
 fireEvent.change(screen.getByLabelText("Store scope"),{target:{value:"a"}});fireEvent.change(screen.getByLabelText("Product filter"),{target:{value:"p"}});fireEvent.change(screen.getByLabelText("Performance from date"),{target:{value:"2026-10-01"}});fireEvent.change(screen.getByLabelText("Performance to date"),{target:{value:"2026-10-02"}});
 fireEvent.click(screen.getByRole("button",{name:"Calculate customer movement"}));await waitFor(()=>expect(screen.getByRole("button",{name:"Export movement CSV"})).not.toBeDisabled());expect(api.call).toHaveBeenLastCalledWith("getProductMovement",{branchId:"a",productId:"p",fromDate:"2026-10-01",toDate:"2026-10-02"});
 fireEvent.click(screen.getByRole("button",{name:"Export movement CSV"}));expect(download.mock.calls[0]?.[1][0]).toMatchObject({storeScope:"a",selectedProductId:"p",calendarDays:2,netUnitsPerCalendarDay:2,includedPartsQuantity:2});
 fireEvent.change(screen.getByLabelText("Performance to date"),{target:{value:"2026-10-03"}});expect(screen.getByRole("button",{name:"Export movement CSV"})).toBeDisabled();expect(screen.queryByRole("article",{name:"Panel"})).toBeNull();
});
it("ignores a late response from the previous scope and enforces inventory export UI",async()=>{
 let finish!:(r:unknown)=>void;api.call.mockImplementation((_name,input)=>input.branchId==="old"?new Promise(r=>{finish=r;}):Promise.resolve(movement));
 const view=render(<ProductMovement branchId="old" fromDate="2026-10-01" toDate="2026-10-02" canExport={false}/>);fireEvent.click(screen.getByRole("button",{name:"Calculate customer movement"}));view.rerender(<ProductMovement branchId="a" fromDate="2026-10-01" toDate="2026-10-02" canExport={false}/>);fireEvent.click(screen.getByRole("button",{name:"Calculate customer movement"}));await screen.findByRole("article",{name:"Panel"});finish({...movement,rows:[{...movement.rows[0],productName:"Stale"}]});await waitFor(()=>expect(screen.queryByText("Stale")).toBeNull());expect(screen.getByRole("button",{name:"Export movement CSV"})).toBeDisabled();expect(screen.getByText("Existing inventory export permission is required.")).toBeVisible();
});
