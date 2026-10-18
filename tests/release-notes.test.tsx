// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReleaseNotes } from "@/features/releases/release-notes";
import { releaseNotes } from "../functions/src/releases/catalog";
const mocks = vi.hoisted(() => ({ api: vi.fn(), profile: { uid: "user-a", organizationId: "org", permissions: ["reports.sales.read"] } }));
vi.mock("@/features/administration/api", () => ({ callAdministration: mocks.api }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: mocks.profile }) }));
vi.mock("@/lib/permissions/roles", () => ({ hasPermission: (profile: { permissions: string[] }, permission: string) => profile.permissions.includes(permission) }));
afterEach(() => { cleanup(); mocks.api.mockReset(); mocks.profile = { uid: "user-a", organizationId: "org", permissions: ["reports.sales.read"] }; });
it("persists dismissal only after confirmation and leaves past notes with authorized links", async () => {
  mocks.api.mockImplementation((_name, input) => Promise.resolve(input.action === "release_notes" ? { acknowledgedReleaseIds: [] } : { acknowledged: true, releaseId: input.releaseId }));
  render(<ReleaseNotes />);
  fireEvent.click(await screen.findByRole("button", { name: "View what’s new" }));
  expect(screen.getByRole("link", { name: "Invoice History" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Banking" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Dealers / Suppliers" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close release notes" }));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss release alert" }));
  await screen.findByRole("button", { name: "What’s new / past releases" });
  expect(mocks.api).toHaveBeenLastCalledWith("getMyAccessContext", { action: "acknowledge_release", releaseId: releaseNotes[0].id });
  fireEvent.click(screen.getByRole("button", { name: "What’s new / past releases" }));
  expect(screen.getByRole("dialog", { name: "What’s new" }).textContent).toContain(releaseNotes[1].title);
});
it("does not inherit a previous user's dismissal and keeps an unconfirmed alert visible", async () => {
  mocks.api.mockResolvedValue({ acknowledgedReleaseIds: [releaseNotes[0].id] });
  const view = render(<ReleaseNotes />);
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  mocks.profile = { uid: "user-b", organizationId: "org", permissions: [] };
  mocks.api.mockResolvedValueOnce({ acknowledgedReleaseIds: [] }).mockRejectedValueOnce(new Error("Offline; dismissal not saved"));
  view.rerender(<ReleaseNotes />);
  fireEvent.click(await screen.findByRole("button", { name: "Dismiss release alert" }));
  expect((await screen.findByRole("alert")).textContent).toContain("not saved");
  expect(screen.getByRole("button", { name: "Dismiss release alert" })).toBeTruthy();
});
it("cannot hide the next user's alert when the previous user's dismissal arrives late", async () => {
  let finish: (value: { acknowledged: boolean; releaseId: string }) => void = () => {};
  mocks.api.mockImplementation((_name,input) => input.action === "release_notes" ? Promise.resolve({ acknowledgedReleaseIds: [] }) : new Promise(resolve => { finish = resolve; }));
  const view = render(<ReleaseNotes />);
  fireEvent.click(await screen.findByRole("button", { name: "Dismiss release alert" }));
  mocks.profile = { uid: "user-b", organizationId: "org", permissions: [] };
  view.rerender(<ReleaseNotes />);
  await screen.findByRole("button", { name: "Dismiss release alert" });
  finish({ acknowledged: true, releaseId: releaseNotes[0].id });
  await waitFor(() => expect(screen.getByRole("button", { name: "Dismiss release alert" }).hasAttribute("disabled")).toBe(false));
});
