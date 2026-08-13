import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Feedback({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "success" | "warning" | "danger" }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "danger" || tone === "warning" ? AlertCircle : Info;
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-xl border p-3.5 text-sm leading-6", tone === "info" && "border-blue-200 bg-blue-50 text-blue-900", tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-900", tone === "warning" && "border-amber-200 bg-amber-50 text-amber-950", tone === "danger" && "border-red-200 bg-red-50 text-red-900")}><Icon className="mt-0.5 size-4 shrink-0"/><div className="min-w-0">{children}</div></div>;
}
