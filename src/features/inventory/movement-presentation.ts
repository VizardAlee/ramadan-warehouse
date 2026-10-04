import type { InventoryEntry } from "@/types/domain";

export interface MovementEvent {
  id: string;
  date: InventoryEntry["effectiveAt"];
  reference: string;
  title: string;
  description: string;
  quantity: number;
  location: string;
  balanceAfter?: number;
  entries: InventoryEntry[];
}

const movementTitles: Record<string, string> = {
  opening_balance: "Initial stock added",
  inventory_receipt: "Stock received",
  location_transfer: "Stock moved",
  damage_transfer: "Moved to damaged stock",
  quarantine_transfer: "Moved for inspection",
  quarantine_release: "Released from inspection",
  return_to_available: "Returned to available stock",
  stock_adjustment: "Stock adjusted",
  stock_count_correction: "Stock count corrected",
  transfer_dispatch: "Stock sent out",
  transfer_receipt: "Transfer received",
  stock_transfer_receipt: "Transfer received",
  discrepancy_resolution: "Stock discrepancy resolved",
  branch_sale: "Sold to customer",
  write_off: "Stock written off",
  reversal: "Previous movement reversed",
};

export function inventoryLocationLabel(
  entry: Pick<InventoryEntry, "locationId" | "externalAccount">,
  locations: Readonly<Record<string, string>>,
) {
  if (entry.locationId) return locations[entry.locationId] ?? "Stock location";
  if (entry.externalAccount === "customer_sales") return "Customer";
  if (entry.externalAccount === "customer_returns") return "Customer return";
  if (entry.externalAccount?.startsWith("supplier:")) return "Supplier";
  if (entry.externalAccount === "migration") return "Initial stock source";
  return entry.externalAccount ? "Outside stock" : "Stock location";
}

export function summarizeInventoryMovements(
  entries: readonly InventoryEntry[],
  locations: Readonly<Record<string, string>>,
): MovementEvent[] {
  const groups = new Map<string, InventoryEntry[]>();
  for (const entry of entries) {
    const key = entry.transactionId || entry.transactionNumber || entry.id;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.entries()].map(([id, lines]) => {
    const first = lines[0]!;
    const physical = lines.filter((line) => Boolean(line.locationId));
    const incoming = physical.filter((line) => line.quantityDelta > 0);
    const outgoing = physical.filter((line) => line.quantityDelta < 0);
    const incomingQuantity = incoming.reduce((sum, line) => sum + line.quantityDelta, 0);
    const outgoingQuantity = outgoing.reduce((sum, line) => sum - line.quantityDelta, 0);
    const quantity = Math.max(incomingQuantity, outgoingQuantity, ...lines.map((line) => Math.abs(line.quantityDelta)));
    const destination = incoming[0] && inventoryLocationLabel(incoming[0], locations);
    const source = outgoing[0] && inventoryLocationLabel(outgoing[0], locations);
    const place = destination ?? source ?? "Stock location";
    const movement = incoming.length && outgoing.length
      ? `Moved ${quantity} from ${source} to ${destination}.`
      : first.transactionType === "branch_sale" && outgoing.length
        ? `Sold ${quantity} from ${place}.`
        : first.transactionType === "opening_balance" && incoming.length
          ? `Initial ${quantity} added to ${place}.`
          : first.transactionType === "inventory_receipt" && incoming.length
            ? `Received ${quantity} into ${place}.`
      : incoming.length
        ? `${quantity} added to ${place}.`
        : outgoing.length
          ? `${quantity} removed from ${place}.`
          : `${quantity} recorded; no store balance changed in this entry.`;
    const affected = incoming[0] ?? outgoing[0];
    const balance = physical.length === 1 ? affected?.balanceAfter : undefined;
    return {
      id,
      date: first.effectiveAt,
      reference: first.transactionNumber,
      title: movementTitles[first.transactionType] ?? "Stock activity",
      description: movement,
      quantity,
      location: place,
      balanceAfter: balance,
      entries: lines,
    };
  });
}
