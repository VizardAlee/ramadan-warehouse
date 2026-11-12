"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { hasAnyPermission } from "@/lib/permissions/roles";
import { callAdministration } from "@/features/administration/api";
export function StockHandoverCard() {
  const { profile, operatingContext } = useAuth();
  if (!profile || !hasAnyPermission(profile, ["sales.handover", "sales.stock.release"])) return null;
  const branchId = operatingContext?.type === "branch" ? operatingContext.id : null;
  return <BranchCard key={branchId ?? "none"} branchId={branchId} />;
}
function BranchCard({ branchId }: { branchId: string | null }) {
  const [label, setLabel] = useState(branchId ? "Checking current handovers…" : "Select a branch to see pending goods.");
  useEffect(() => {
    if (!branchId) return;
    let active = true;
    const refresh = () => callAdministration<object, { rows: unknown[]; nextCursor: string | null }>("getSaleDocument", { action: "stock_collections", branchId }).then(result => { if (active) setLabel(`${result.rows.length}${result.nextCursor ? "+" : ""} invoices awaiting physical handover`); }).catch(() => { if (active) setLabel("Queue could not refresh. Open it to retry; do not assume it is empty."); });
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, [branchId]);
  return <Link href="/collections" className="surface block border-2 border-violet-200 p-5"><h2 className="text-xl font-semibold">Goods awaiting collection</h2><p role="status">{label}</p><p>Review your branch’s queue and record only goods physically handed to customers.</p></Link>;
}
