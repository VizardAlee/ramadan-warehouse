// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ verify: vi.fn(), confirm: vi.fn(), replace: vi.fn(), query: "mode=resetPassword&oobCode=fixture-code&continueUrl=https://untrusted.invalid" }));
vi.mock("firebase/auth", () => ({ verifyPasswordResetCode: state.verify, confirmPasswordReset: state.confirm }));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseServices: () => ({ auth: "fixture-auth" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }), useSearchParams: () => new URLSearchParams(state.query) }));
import { PasswordSetup } from "../src/features/auth/password-setup";
beforeEach(() => { vi.resetAllMocks(); state.verify.mockResolvedValue("fixture@example.test"); state.confirm.mockResolvedValue(undefined); state.query = "mode=resetPassword&oobCode=fixture-code&continueUrl=https://untrusted.invalid"; });
afterEach(cleanup);
async function open() { const view = render(<PasswordSetup />); await screen.findByLabelText("Confirm password"); return view; }
function fill(password = "Fixture-password-123", confirmation = password) { fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } }); fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirmation } }); }
function submit() { fireEvent.submit(screen.getByRole("button", { name: "Save password" }).closest("form")!); }
describe("password setup", () => {
  it("requires matching passwords without sending invalid entries", async () => { await open(); fill("Fixture-password-123", "Other-password"); submit(); expect(screen.getByRole("alert").textContent).toContain("do not match"); expect(state.confirm).not.toHaveBeenCalled(); fill("short"); submit(); expect(screen.getByRole("alert").textContent).toContain("8 characters"); expect(state.confirm).not.toHaveBeenCalled(); });
  it("saves matching passwords once and shows success without automatic navigation", async () => { let done!: () => void; state.confirm.mockReturnValue(new Promise<void>(resolve => { done = resolve; })); await open(); fill(); submit(); fireEvent.submit(screen.getByRole("button", { name: "Saving password…" }).closest("form")!); expect(state.confirm).toHaveBeenCalledTimes(1); done(); await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Password saved")); expect(state.replace).not.toHaveBeenCalled(); expect(screen.queryByLabelText("New password")).toBeNull(); });
  it("rejects expired links before accepting passwords", async () => { state.verify.mockRejectedValue({ code: "auth/expired-action-code" }); render(<PasswordSetup />); expect((await screen.findByRole("alert")).textContent).toContain("expired"); expect(state.confirm).not.toHaveBeenCalled(); });
  it("rejects missing or wrong action modes", async () => { state.query = "mode=verifyEmail&oobCode=fixture-code"; render(<PasswordSetup />); await screen.findByRole("alert"); expect(state.verify).not.toHaveBeenCalled(); });
  it("does not redirect after failure and allows retry", async () => { state.confirm.mockRejectedValueOnce({ code: "auth/network-request-failed" }); await open(); fill(); submit(); await screen.findByRole("alert"); expect(state.replace).not.toHaveBeenCalled(); submit(); await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Password saved")); expect(state.replace).not.toHaveBeenCalled(); });
  it("clears fields and revalidates when navigating to a different link", async () => { const view = await open(); fill(); state.query = "mode=resetPassword&oobCode=other-fixture"; view.rerender(<PasswordSetup />); await screen.findByLabelText("Confirm password"); expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe(""); expect(state.verify).toHaveBeenLastCalledWith("fixture-auth", "other-fixture"); });
  it("does not redirect after leaving while save is pending", async () => { let done!: () => void; state.confirm.mockReturnValue(new Promise<void>(resolve => { done = resolve; })); const view = await open(); fill(); submit(); view.unmount(); done(); await Promise.resolve(); expect(state.replace).not.toHaveBeenCalled(); });
});
