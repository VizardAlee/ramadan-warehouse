import { cn } from "@/lib/utils";

const statusTones: Record<string, Tone> = {
  active: "success", approved: "success", received: "success", reconciled: "success", closed: "success", checked: "success", packed: "success",
  submitted: "info", under_review: "info", reserved: "info", picking: "info", dispatched: "info", in_transit: "info", partially_received: "info", partially_approved: "info", partially_reserved: "info", partially_dispatched: "info",
  discrepancy: "warning", disputed: "warning", damaged: "warning", returned: "warning", changes_requested: "warning", quarantined: "warning",
  rejected: "danger", cancelled: "danger", written_off: "danger", inactive: "neutral", suspended: "danger", draft: "neutral",
};
type Tone = "success" | "warning" | "danger" | "info" | "neutral";
export function StatusBadge({ children, tone, status }: { children?: React.ReactNode; tone?: Tone; status?: string }) {
  const label = String(children ?? status ?? "").replaceAll("_", " ");
  const resolved = tone ?? statusTones[String(status ?? children).toLowerCase()] ?? "neutral";
  return <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize", resolved === "success" && "bg-emerald-100 text-emerald-800", resolved === "warning" && "bg-amber-100 text-amber-900", resolved === "danger" && "bg-red-100 text-red-800", resolved === "info" && "bg-blue-100 text-blue-800", resolved === "neutral" && "bg-slate-100 text-slate-700")}><span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current"/>{label}</span>;
}
