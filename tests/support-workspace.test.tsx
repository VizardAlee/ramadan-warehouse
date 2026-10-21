// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ call: vi.fn(), config: vi.fn(), prepare: vi.fn(), context: vi.fn(), auth: { user: { uid: "owner" }, profile: { organizationId: "org", authorizationVersion: 1 }, operatingContext: { type: "branch", id: "one" } } }));
vi.mock("../src/features/support/client", () => ({ callSupport: api.call, loadSupportConfig: api.config, prepareSupportScreenshot: api.prepare, supportContext: api.context }));
vi.mock("../src/features/auth/auth-context", () => ({ useAuth: () => api.auth }));
import { SupportWorkspace } from "../src/features/support/workspace";
import HelpPage from "../src/app/(protected)/help/page";
const id = "RS-" + "a".repeat(32);
const config = { url: "https://ramadan-support-gateway-demo.uc.gateway.dev/supportWorkspace", build: "test-release" };
const ticket = { id, kind: "bug", description: "Synthetic support issue", expected: "", context: { screen: "/pos", build: "test", browser: "Other", device: "mobile", clientTime: "", errorReference: "" }, scope: { type: "branch", id: "one" }, roles: ["sales_cashier"], hasScreenshot: false, status: "new", revision: 1, createdAt: 1792584000000, notification: "pending" };
const empty = { tickets: [], nextCursor: null, canAdmin: false };
beforeEach(() => {
  vi.resetAllMocks(); window.history.replaceState({}, "", "/help"); api.auth.operatingContext = { type: "branch", id: "one" };
  api.config.mockResolvedValue(config); api.context.mockReturnValue(ticket.context);
  api.call.mockImplementation(async (_config, input) => input.action === "list" ? empty : ticket);
});
afterEach(cleanup);
const button = () => screen.getByRole("button", { name: "Send private report" }) as HTMLButtonElement;
async function ready() { await waitFor(() => expect((screen.getByRole("button", { name: "Refresh tickets" }) as HTMLButtonElement).disabled).toBe(false)); }
function describeIssue(text = "1234567890") { fireEvent.change(screen.getByRole("textbox", { name: /What happened/ }), { target: { value: text } }); }
function confirm() { fireEvent.click(screen.getByRole("checkbox")); }
describe("private support form and history", () => {
  it("moves keyboard focus to the saved receipt and opened ticket", async () => {
    render(<SupportWorkspace/>); await ready(); describeIssue(); confirm(); fireEvent.click(button());
    await screen.findByText("Ticket saved privately");
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-live")).toBe("polite"));
    const view = screen.getByRole("button", { name: "View saved ticket" });
    await waitFor(() => expect((view as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(view);
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-labelledby")).toBe("ticket-title"));
  });
  it("closing a pending image read restores controls and ignores its late response", async () => {
    let finish!: (value: unknown) => void;
    api.call.mockImplementation(async (_config,input) => input.action === "list" ? { ...empty, tickets: [{ ...ticket, hasScreenshot: true }] } : input.action === "attachment" ? await new Promise(resolve => { finish = resolve; }) : { ...ticket, hasScreenshot: true });
    render(<SupportWorkspace/>); await ready(); fireEvent.click(screen.getByRole("button", { name: id })); await screen.findByRole("heading", { name: id });
    fireEvent.click(screen.getByRole("button", { name: "Review private screenshot" }));
    fireEvent.click(screen.getByRole("button", { name: "Close ticket" }));
    expect((screen.getByRole("button", { name: "Refresh tickets" }) as HTMLButtonElement).disabled).toBe(false);
    finish({ mimeType: "image/png", base64: "AAAA" });
    await waitFor(() => expect(screen.queryByAltText("Private screenshot attached to this ticket")).toBeNull());
    expect(screen.queryByRole("heading", { name: id })).toBeNull();
  });
  it("shows the exact trimmed ten-character rule and requires privacy review", async () => {
    render(<SupportWorkspace/>); await ready();
    describeIssue(" 123456789 "); expect(button().disabled).toBe(true); expect(screen.getByText("9 / 10 minimum characters. Add 1 more character.")).toBeTruthy();
    describeIssue(" 1234567890 "); expect(button().disabled).toBe(true); confirm(); expect(button().disabled).toBe(false);
    fireEvent.click(button()); await screen.findByText("Ticket saved privately");
    const created = api.call.mock.calls.find(([, input]) => input.action === "create")?.[1];
    expect(created.report).toMatchObject({ description: " 1234567890 ", privacyConfirmed: true, kind: "bug" }); expect(created.report.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(screen.getByText(/Support notification pending/)).toBeTruthy();
  });
  it("invalidates the privacy review after changing text and rejects oversized expected outcomes", async () => {
    render(<SupportWorkspace/>); await ready(); describeIssue(); confirm(); expect(button().disabled).toBe(false);
    describeIssue("Description changed"); expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: /What did you expect/ }), { target: { value: "x".repeat(2001) } }); confirm(); expect(button().disabled).toBe(true);
    expect(screen.getByText("Shorten the expected outcome to 2,000 characters.")).toBeTruthy();
  });
  it("freezes uncertain submission content and reuses the same request reference on retry", async () => {
    let attempts = 0;
    api.call.mockImplementation(async (_config, input) => { if (input.action === "create" && attempts++ === 0) throw Error("Synthetic timeout"); return input.action === "list" ? empty : ticket; });
    render(<SupportWorkspace/>); await ready(); describeIssue(); confirm(); fireEvent.click(button());
    const retry = await screen.findByRole("button", { name: "Retry unchanged report" });
    expect(screen.getByRole("textbox", { name: /What happened/ }).matches(":disabled")).toBe(true);
    fireEvent.click(retry); await screen.findByText("Ticket saved privately");
    const attemptsSent = api.call.mock.calls.filter(([,input]) => input.action === "create").map(([,input]) => input.report);
    expect(attemptsSent).toHaveLength(2); expect(attemptsSent[0]).toEqual(attemptsSent[1]);
  });
  it("blocks double submissions synchronously while the receipt is pending", async () => {
    let finish!: (value: unknown) => void;
    api.call.mockImplementation(async (_config,input) => input.action === "create" ? await new Promise(resolve => { finish = resolve; }) : empty);
    render(<SupportWorkspace/>); await ready(); describeIssue(); confirm(); const send = button(); fireEvent.click(send); fireEvent.click(send);
    expect(api.call.mock.calls.filter(([,input]) => input.action === "create")).toHaveLength(1); finish(ticket); await screen.findByText("Ticket saved privately");
  });
  it("can reconnect without losing the in-memory draft", async () => {
    api.config.mockRejectedValueOnce(Error("Synthetic connection unavailable")); render(<SupportWorkspace/>);
    await screen.findByText("Synthetic connection unavailable"); describeIssue("Preserve this draft"); fireEvent.click(screen.getByRole("button", { name: "Refresh tickets" })); await ready();
    expect((screen.getByRole("textbox", { name: /What happened/ }) as HTMLTextAreaElement).value).toBe("Preserve this draft"); expect(api.config).toHaveBeenCalledTimes(2);
  });
  it("opens authenticated ticket links and retains continuation on an empty scan page", async () => {
    window.history.replaceState({}, "", "/help?ticket=" + id);
    api.call.mockImplementation(async (_config,input) => input.action === "list" ? { ...empty, nextCursor: "bounded-next-page" } : ticket);
    render(<SupportWorkspace/>); await screen.findByRole("heading", { name: id });
    expect(api.call).toHaveBeenCalledWith(config, { action: "get", id }); fireEvent.click(screen.getByRole("button", { name: "More tickets" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith(config, { action: "list", all: false, cursor: "bounded-next-page" }));
  });
  it("does not expose admin actions to ordinary users or send a status change on view", async () => {
    api.call.mockImplementation(async (_config,input) => input.action === "list" ? { ...empty, tickets: [ticket] } : ticket);
    render(<SupportWorkspace/>); await ready(); fireEvent.click(screen.getByRole("button", { name: id })); await screen.findByRole("heading", { name: id });
    expect(screen.queryByText("Administrator actions")).toBeNull(); expect(api.call.mock.calls.some(([,input]) => input.action === "status" || input.action === "retryNotification")).toBe(false);
  });
  it("clears private drafts immediately when operating scope changes", async () => {
    const view = render(<HelpPage/>); await ready(); describeIssue("Private draft in branch one");
    api.auth.operatingContext = { type: "branch", id: "two" }; view.rerender(<HelpPage/>); await ready();
    expect((screen.getByRole("textbox", { name: /What happened/ }) as HTMLTextAreaElement).value).toBe("");
  });
  it("requires preview review after preparing/removing an optional image", async () => {
    let finish!: (value: unknown) => void; api.prepare.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<SupportWorkspace/>); await ready(); describeIssue(); confirm();
    const picker = screen.getByLabelText(/Cropped PNG screenshot/); fireEvent.change(picker, { target: { files: [new File(["synthetic"], "private-original-name.png", { type: "image/png" })] } });
    expect(button().disabled).toBe(true); expect(screen.getByText("Preparing screenshot…")).toBeTruthy();
    finish({ base64: "AAAA", preview: "data:image/png;base64,AAAA" }); await screen.findByAltText(/Your screenshot preview/);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false); confirm(); expect(button().disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove screenshot" })); expect(screen.queryByAltText(/Your screenshot preview/)).toBeNull(); expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
});
