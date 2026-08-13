import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="rounded-xl border border-dashed bg-white px-5 py-10 text-center"><span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-emerald-50"><Icon className="size-6 text-[var(--brand)]"/></span><h2 className="font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">{description}</p>{action && <div className="mt-5 flex justify-center">{action}</div>}</div>;
}
