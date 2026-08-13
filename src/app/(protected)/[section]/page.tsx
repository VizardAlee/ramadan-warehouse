import { Construction } from "lucide-react";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { AuditList } from "@/features/audit/audit-list";
import { TransferList } from "@/features/transfers/transfer-list";

const sections: Record<string, { title: string; description: string }> = {
  products: { title: "Products", description: "Product catalogue and SKU history begin in Phase 2." },
  inventory: { title: "Inventory", description: "The immutable stock movement ledger and derived balances begin in Phase 2." },
  requests: { title: "Branch requests", description: "Request creation and approvals begin in Phase 3." },
  transfers: { title: "Transfers", description: "Direct transfers and reservations begin in Phase 4." },
  costs: { title: "Transfer costs", description: "Cost approvals and reconciliation begin in Phase 7." },
  reports: { title: "Reports", description: "Operational reports are added alongside their source modules." },
  administration: { title: "Administration", description: "Organization, branch, warehouse, location, role and user contracts are established. Trusted management functions will be expanded after production provisioning policy is approved." },
  audit: { title: "Audit history", description: "Append-only audit infrastructure is ready; sensitive operations in later phases will write entries server-side." },
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; if (section === "costs") return <TransferList view="costs"/>; if (section === "audit") return <AuditList/>; const value = sections[section]; if (!value) notFound(); return <div className="page-stack"><div><h1 className="page-title">{value.title}</h1><p className="page-description">Operational workspace</p></div><EmptyState icon={Construction} title="Workspace prepared" description={value.description}/></div>; }
