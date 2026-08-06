import { cn } from "@/lib/utils";

export function StatusBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "success" | "warning" | "neutral" }) {
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", tone === "success" && "bg-emerald-100 text-emerald-800", tone === "warning" && "bg-amber-100 text-amber-800", tone === "neutral" && "bg-slate-100 text-slate-700")}>{children}</span>;
}
