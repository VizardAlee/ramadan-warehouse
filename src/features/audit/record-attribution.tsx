import { FinancialText } from "@/features/finance/financial-privacy";
export interface ActorLabels { [field: string]: { userId: string; currentName: string | null } | undefined }
export function RecordAttribution({ actors, field, userId }: { actors?: ActorLabels; field: string; userId?: string | null }) {
  const actor = actors?.[field], id = actor?.userId ?? userId;
  return <span className="block break-all text-xs"><FinancialText>{actor?.currentName ?? id ?? "Unknown (not recorded)"}</FinancialText>{actor?.currentName && <span className="block text-[var(--muted)]">Current name</span>}</span>;
}
