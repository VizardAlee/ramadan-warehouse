import { PermissionTabs } from "@/components/layout/permission-tabs";

const tabs = [
  { href: "/inventory", label: "Stock overview", permissions: ["inventory.read"] },
  { href: "/inventory/receipts", label: "Receipts", permissions: ["inventory.receive"] },
  { href: "/inventory/opening-stock", label: "Opening stock", permissions: ["inventory.opening_stock"] },
  { href: "/inventory/movements", label: "Internal movement", permissions: ["inventory.move_internal"] },
  { href: "/inventory/adjustments", label: "Adjustments", permissions: ["inventory.adjust"] },
  { href: "/inventory/counts", label: "Stock counts", permissions: ["inventory.count"] },
  { href: "/inventory/reconciliation", label: "Reconciliation", permissions: ["inventory.reconcile"] },
  { href: "/inventory/assets", label: "Serials & lots", permissions: ["reports.inventory.read"] },
] as const;

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-stack">
      <PermissionTabs label="Inventory sections" tabs={tabs} />
      {children}
    </div>
  );
}
