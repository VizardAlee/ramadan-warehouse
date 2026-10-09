// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationalPhotos } from "@/features/pos/operational-photos";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("operational serial photos", () => {
  it.each(["purchase_receipt", "customer_return"] as const)("routes %s evidence to its original workspace without loading another module", async kind => {
    api.call.mockResolvedValue({ evidence: [] });
    render(<OperationalPhotos kind={kind} recordId="original-record" stage={kind === "purchase_receipt" ? "receiving" : "inspection"} serials={[]} canUpload={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Photos & serial evidence" }));
    await screen.findByText("No photos recorded yet.");
    expect(api.call).toHaveBeenCalledWith(kind === "purchase_receipt" ? "getProcurementWorkspace" : "getSaleReturnWorkspace", { action: "list_evidence", recordId: "original-record", ...(kind === "purchase_receipt" ? { evidenceKind: kind } : {}) });
    expect(screen.queryByRole("button", { name: "Save photo evidence" })).toBeNull();
  });
  it("keeps a definite business rejection editable instead of trapping an invalid photo in retry", async () => {
    api.call.mockImplementation(async (_endpoint, input) => {
      if (input.action === "upload_evidence") throw Object.assign(new Error("Choose a matching stage"), { diagnosticCode: "OPERATIONAL_EVIDENCE_ACTION_REQUIRED" });
      return { evidence: [] };
    });
    render(<OperationalPhotos kind="aftersales" recordId="case" stage="intake" serials={[]} canUpload />);
    fireEvent.click(screen.getByRole("button", { name: "Photos & serial evidence" }));
    await screen.findByText("No photos recorded yet.");
    fireEvent.change(screen.getByLabelText("Photo description"), { target: { value: "Condition at intake" } });
    fireEvent.change(screen.getByLabelText(/Choose photo \/ use camera/), { target: { files: [new File(["photo"], "photo.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Save photo evidence" }));
    await screen.findByText("Choose a matching stage");
    expect(screen.queryByRole("button", { name: "Retry same photo" })).toBeNull();
    expect(screen.getByLabelText("Photo description").closest("fieldset")?.disabled).toBe(false);
  });
  it("loads evidence only when expanded and keeps read-only users away from uploads", async () => {
    api.call.mockResolvedValue({ evidence: [{ evidenceId: "photo", stage: "intake", serialNumber: "SN-1", note: "Label confirmed", uploadedAt: null, recordedStatus: "open" }] });
    render(<OperationalPhotos kind="aftersales" recordId="case" stage="intake" serials={["SN-1"]} canUpload={false} />);
    expect(api.call).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Photos & serial evidence" }));
    await screen.findByText("Label confirmed");
    expect(api.call).toHaveBeenCalledWith("getAftersalesWorkspace", { action: "list_evidence", recordId: "case" });
    expect(screen.queryByRole("button", { name: "Save photo evidence" })).toBeNull();
  });
  it("freezes a failed upload and retries the original serial, content and request reference", async () => {
    let uploads = 0;
    api.call.mockImplementation(async (_endpoint, input) => {
      if (input.action === "upload_evidence") { if (++uploads === 1) throw new Error("Connection lost"); return { uploaded: false }; }
      return { evidence: [] };
    });
    render(<OperationalPhotos kind="supplier_return" recordId="return" stage="handover" serials={[]} serialRequired canUpload />);
    fireEvent.click(screen.getByRole("button", { name: "Photos & serial evidence" }));
    await screen.findByText("No photos recorded yet.");
    fireEvent.change(screen.getByLabelText("Photo description"), { target: { value: "Supplier confirmed serial" } });
    fireEvent.change(screen.getByLabelText(/Choose photo \/ use camera/), { target: { files: [new File(["photo"], "photo.png", { type: "image/png" })] } });
    expect(screen.getByRole("button", { name: "Save photo evidence" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Confirm returned serial"), { target: { value: "SUP-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save photo evidence" }));
    await screen.findByText("Connection lost");
    expect(screen.getByLabelText("Confirm returned serial").closest("fieldset")?.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry same photo" }));
    await waitFor(() => expect(uploads).toBe(2));
    const calls = api.call.mock.calls.filter(([, input]) => input.action === "upload_evidence");
    expect(calls[0]![1]).toEqual(calls[1]![1]);
    expect(calls[0]![1]).toMatchObject({ recordId: "return", stage: "handover", serialNumber: "SUP-1", note: "Supplier confirmed serial" });
  });
});
