"use client";
import { useAuth } from "@/features/auth/auth-context";
import { hasAnyPermission } from "@/lib/permissions/roles";
import { DashboardLocationSwitcher } from "@/features/dashboard/location-switcher";
import { StockHandoverQueue } from "@/features/pos/stock-handover-queue";
export default function CollectionsPage() {
  const { profile, user, operatingContext } = useAuth();
  if (!profile || !hasAnyPermission(profile, ["sales.handover", "sales.stock.release"])) return <p>Branch handover access has not been assigned to this account.</p>;
  const branchId = operatingContext?.type === "branch" ? operatingContext.id : null;
  return <div className="space-y-5"><h1 className="text-2xl font-semibold">Stock handovers</h1><DashboardLocationSwitcher />{branchId ? <StockHandoverQueue key={`${user?.uid}:${branchId}`} branchId={branchId} scope={`${profile.organizationId}:${user?.uid}`} /> : <p>Select an assigned branch to view goods awaiting collection.</p>}</div>;
}
