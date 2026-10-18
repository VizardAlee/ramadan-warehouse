type Row = Record<string, unknown>;
export function stockResumeAction(transfer: Row) {
  const input = transfer.activeStockExecutionInput;
  const kind = transfer.activeStockExecutionKind;
  if (!transfer.activeStockExecutionId || !input || typeof input !== "object" || Array.isArray(input)
    || (kind !== "dispatch" && kind !== "receipt") || (input as Row).transferId !== transfer.id) return null;
  if (typeof transfer.activeStockExecutionEntityId !== "string" || (input as Row)[kind === "dispatch" ? "dispatchId" : "receiptId"] !== transfer.activeStockExecutionEntityId) return null;
  return { callable: kind === "dispatch" ? "confirmTransferDispatch" : "confirmTransferReceipt", kind, input: input as Row };
}

/** The guided full-good receipt is scoped to one immutable dispatch. Older
 * records without exact manifests/claims require detailed evidence review. */
export function goodDispatchReceipt(dispatchId: string | undefined, manifests: Row[], balances: Row[]) {
  const review = "Dispatch-specific stock evidence is unavailable or inconsistent. Ask the responsible manager to review the dispatch and use detailed receiving; do not use transfer-wide totals.";
  const rows = manifests.filter(row => row.dispatchId === dispatchId);
  if (!dispatchId || !rows.length || new Set(rows.map(row => row.transferItemId)).size !== rows.length) return { lines: [], review };
  const lines = [];
  for (const row of rows) {
    const itemId = String(row.transferItemId);
    const claim = balances.find(balance => balance.dispatchId === dispatchId && balance.transferItemId === itemId);
    const before = Number(claim?.claimedQuantity ?? 0), total = Number(row.quantity);
    if (row.allocationVersion !== 2 || !Number.isSafeInteger(total) || !Number.isSafeInteger(before) || before < 0 || before > total || (before && claim?.allocationVersion !== 2)) return { lines: [], review };
    const quantity = total - before;
    if (!quantity) continue;
    if (!["quantity", "serial", "batch"].includes(String(row.trackingType)) || ![row.serialItemIds ?? [], claim?.claimedSerialItemIds ?? [], row.lotAllocations ?? [], claim?.claimedLotAllocations ?? []].every(Array.isArray)) return { lines: [], review };
    const serials = (row.serialItemIds ?? []) as string[];
    const claimedSerials = (claim?.claimedSerialItemIds ?? []) as string[];
    const serialItemIds = serials.filter(id => !claimedSerials.includes(id));
    const claimedLots = (claim?.claimedLotAllocations ?? []) as { lotId: string; quantity: number }[];
    if ([...((row.lotAllocations ?? []) as { lotId: string; quantity: number }[]), ...claimedLots].some(lot => !lot || typeof lot.lotId !== "string" || !Number.isSafeInteger(lot.quantity) || lot.quantity <= 0)) return { lines: [], review };
    const lots = ((row.lotAllocations ?? []) as { lotId: string; quantity: number }[]).map(lot => ({ lotId: lot.lotId, quantity: lot.quantity - (claimedLots.find(used => used.lotId === lot.lotId)?.quantity ?? 0), disposition: "received" as const }));
    if ((row.trackingType === "serial" && (serialItemIds.length !== quantity || new Set(serialItemIds).size !== quantity))
      || (row.trackingType === "batch" && (lots.some(lot => lot.quantity < 0) || lots.reduce((sum, lot) => sum + lot.quantity, 0) !== quantity))) return { lines: [], review };
    lines.push({ transferItemId: itemId, receivedQuantity: quantity, damagedQuantity: 0, missingQuantity: 0, rejectedQuantity: 0,
      serialItemIds: row.trackingType === "serial" ? serialItemIds : [], damagedSerialItemIds: [], lotAllocations: row.trackingType === "batch" ? lots.filter(lot => lot.quantity > 0) : [] });
  }
  return { lines, review: lines.length ? "" : "This dispatch has no unreceived goods. Refresh its receipt history before continuing." };
}
