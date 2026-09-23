"use client";

import { Bell } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { NotificationCard } from "@/features/notifications/notification-card";
import { useNotifications } from "@/features/notifications/use-notifications";

export default function NotificationsPage() {
  const { rows, loading, error, unreadCount, markRead } = useNotifications();
  const actions = rows.filter((item) => item.actionRequired);
  const updates = rows.filter((item) => !item.actionRequired);
  return (
    <div className="page-stack">
      <PageHeader eyebrow="Your inbox" title="Notifications" description={`${unreadCount} unread · Recent tasks and updates for your assigned locations.`} />
      {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">{error}</p>}
      {loading ? <p className="text-sm text-[var(--muted)]">Loading notifications…</p> : rows.length === 0 ? (
        <EmptyState icon={Bell} title="All clear" description="New tasks and updates will appear here." />
      ) : (
        <>
          <section aria-label="Action needed" className="space-y-3">
            <h2 className="text-lg font-semibold">Action needed ({actions.length})</h2>
            {actions.length ? actions.map((item) => <NotificationCard key={item.id} item={item} onRead={markRead} />) : <p className="text-sm text-[var(--muted)]">No action is waiting for you.</p>}
          </section>
          <section aria-label="Recent updates" className="space-y-3">
            <h2 className="text-lg font-semibold">Recent updates</h2>
            {updates.length ? updates.map((item) => <NotificationCard key={item.id} item={item} onRead={markRead} />) : <p className="text-sm text-[var(--muted)]">No recent updates.</p>}
          </section>
        </>
      )}
    </div>
  );
}
