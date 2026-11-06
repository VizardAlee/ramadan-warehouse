import { PostingForm } from "@/features/inventory/posting-form";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string | string[]; locationId?: string | string[]; referenceNumber?: string | string[] }>;
}) {
  const { productId, locationId, referenceNumber } = await searchParams;
  return (
    <PostingForm
      mode="opening"
      initialProductId={typeof productId === "string" ? productId : undefined}
      initialLocationId={typeof locationId === "string" ? locationId : undefined}
      replacementReference={typeof referenceNumber === "string" ? referenceNumber : undefined}
    />
  );
}
