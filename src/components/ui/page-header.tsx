import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, eyebrow, actions, className }: { title: string; description?: string; eyebrow?: string; actions?: ReactNode; className?: string }) {
  return <header className={cn("flex min-w-0 flex-wrap items-end justify-between gap-4", className)}><div className="min-w-0">{eyebrow && <p className="mb-1 text-xs font-bold uppercase tracking-[.12em] text-[var(--brand)]">{eyebrow}</p>}<h1 className="page-title break-words">{title}</h1>{description && <p className="page-description">{description}</p>}</div>{actions && <div className="action-row w-full sm:w-auto">{actions}</div>}</header>;
}
