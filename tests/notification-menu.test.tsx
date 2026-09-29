// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationMenu } from "@/features/notifications/notification-menu";

const inbox = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  markRead: vi.fn(),
  clearAll: vi.fn(),
}));

vi.mock("@/features/notifications/use-notifications", () => ({
  useNotifications: () => ({
    rows: inbox.rows,
    loading: false,
    error: null,
    unreadCount: inbox.rows.filter((item) => !item.readAt).length,
    markRead: inbox.markRead,
    clearAll: inbox.clearAll,
  }),
}));

beforeEach(() => {
  inbox.rows = [{
    id: "notification-1",
    title: "Payment needs confirmation",
    body: "Open the sale to confirm payment.",
    href: "/pos?order=order-1",
    actionRequired: true,
    occurredAt: { toDate: () => new Date("2026-09-29T10:00:00Z") },
    readAt: null,
  }];
  inbox.markRead.mockReset().mockResolvedValue(undefined);
  inbox.clearAll.mockReset().mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("notification bell dropdown", () => {
  it("opens unread items and links directly to their task", () => {
    render(<NotificationMenu />);
    expect(screen.queryByText("Payment needs confirmation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    expect(screen.getByRole("link", { name: /Payment needs confirmation/ }).getAttribute("href")).toBe("/pos?order=order-1");
    const task = screen.getByRole("link", { name: /Payment needs confirmation/ });
    task.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(task);
    expect(inbox.markRead).toHaveBeenCalledWith("notification-1");
  });

  it("hides a notification after it is marked as read", () => {
    const view = render(<NotificationMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    expect(inbox.markRead).toHaveBeenCalledWith("notification-1");
    inbox.rows = [{ ...inbox.rows[0], readAt: { toDate: () => new Date() } }];
    view.rerender(<NotificationMenu />);
    expect(screen.queryByText("Payment needs confirmation")).toBeNull();
    expect(screen.getByText("You’re all caught up.")).toBeTruthy();
  });

  it("clears all unread items without deleting inbox history", async () => {
    render(<NotificationMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear all/ }));
    await waitFor(() => expect(inbox.clearAll).toHaveBeenCalledOnce());
    expect(screen.getByRole("link", { name: "View notification history" }).getAttribute("href")).toBe("/notifications");
  });

  it("closes with Escape and restores focus to the bell", () => {
    render(<NotificationMenu />);
    const trigger = screen.getByRole("button", { name: "Notifications, 1 unread" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Payment needs confirmation")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
