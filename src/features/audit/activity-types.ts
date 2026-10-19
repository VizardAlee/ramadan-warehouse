export interface ActivityRow {
  id: string; action: string; module: string; entityType: string; entityId: string;
  actorUserId: string; actorRoleId: string; actorName: string | null;
  actorNameEvidence: "recorded_snapshot" | "current_name" | "uid_only";
  reference: string | null; reason: string | null; correlationId: string; sourceFunction: string;
  location: Record<string, string> | null; createdAt: string | null;
}
export interface ActivityPage { rows: ActivityRow[]; nextCursor: string | null; scanned: number; scanLimited: boolean; note: string }
