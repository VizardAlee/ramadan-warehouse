import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return <div className="rounded-xl border border-dashed bg-white p-10 text-center"><Icon className="mx-auto mb-4 size-8 text-[var(--brand)]"/><h2 className="font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-lg text-sm text-[var(--muted)]">{description}</p></div>;
}
