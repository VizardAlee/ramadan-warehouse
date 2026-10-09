// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CollectionPhotoUpload, CollectionPhotoViewer } from "@/features/pos/collection-photos";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("uploads optional evidence with a stable retry key and product reference", async () => {
  api.call.mockRejectedValueOnce(new Error("Network interrupted")).mockResolvedValueOnce({ evidenceId: "photo1", saleItemId: "item1" });
  const changed = vi.fn(), busy = vi.fn();
  render(<CollectionPhotoUpload saleId="sale1" items={[{ id: "item1", productName: "Panel" }]} photos={[]} onChange={changed} locked={false} onBusy={busy} />);
  fireEvent.change(screen.getByLabelText("Choose collection photo"), { target: { files: [new File(["image-bytes"], "photo.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Upload collection photo" }));
  await screen.findByText("Network interrupted");
  fireEvent.click(screen.getByRole("button", { name: "Retry photo upload" }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith([{ evidenceId: "photo1", saleItemId: "item1" }]));
  expect(api.call.mock.calls[0]![1]).toEqual(api.call.mock.calls[1]![1]);
  expect(api.call.mock.calls[0]![1]).toMatchObject({ action: "upload_collection_photo", saleId: "sale1", saleItemId: "item1", contentType: "image/png" });
  expect(busy).toHaveBeenLastCalledWith(false);
});
it("rejects unsupported files without calling the server", () => {
  render(<CollectionPhotoUpload saleId="sale1" items={[{ id: "item1", productName: "Panel" }]} photos={[]} onChange={vi.fn()} locked={false} onBusy={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Choose collection photo"), { target: { files: [new File(["<svg/>"], "bad.svg", { type: "image/svg+xml" })] } });
  expect(screen.getByRole("alert").textContent).toContain("JPEG or PNG");
  expect(api.call).not.toHaveBeenCalled();
});
it("fetches recorded photos through the authenticated document endpoint", async () => {
  api.call.mockResolvedValue({ contentType: "image/png", base64: "aGVsbG8=", uploadedAt: null });
  render(<CollectionPhotoViewer saleId="sale1" evidenceIds={["photo1"]} />);
  fireEvent.click(screen.getByRole("button", { name: "View collection photo 1" }));
  await screen.findByAltText("Recorded collection evidence");
  expect(api.call).toHaveBeenCalledWith("getSaleDocument", { action: "collection_photo", saleId: "sale1", evidenceId: "photo1" });
  fireEvent.click(screen.getByRole("button", { name: "Close photo" }));
  expect(screen.queryByAltText("Recorded collection evidence")).toBeNull();
});
