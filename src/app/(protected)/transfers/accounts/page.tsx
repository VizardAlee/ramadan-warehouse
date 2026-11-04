import { BranchTradingWorkspace } from "@/features/branch-trading/branch-trading-workspace";
export default async function BranchTradingPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const { invoice } = await searchParams;
  return <BranchTradingWorkspace invoiceId={typeof invoice === "string" ? invoice : undefined} />;
}
