import { logger } from "firebase-functions";

export interface OperationLog {
  correlationId: string;
  functionName: string;
  organizationId?: string;
  actorUid?: string;
  entityType?: string;
  entityId?: string;
  operation: string;
  outcome: "started" | "succeeded" | "failed";
  durationMs?: number;
  errorCode?: string;
  idempotencyKey?: string;
  retryCount?: number;
}

const safe = (value: OperationLog) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

export function logOperation(value: OperationLog): void {
  const fields = safe(value);
  if (value.outcome === "failed") logger.error("warehouse_operation", fields);
  else logger.info("warehouse_operation", fields);
}
