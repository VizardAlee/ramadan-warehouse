import { StockTransferDetail } from "@/features/transfers/stock-transfer-workspace";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StockTransferDetail transferId={id} />;
}
