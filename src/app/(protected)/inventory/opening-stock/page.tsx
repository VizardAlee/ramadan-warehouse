import { PostingForm } from "@/features/inventory/posting-form";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string | string[] }>;
}) {
  const productId = (await searchParams).productId;
  return (
    <PostingForm
      mode="opening"
      initialProductId={typeof productId === "string" ? productId : undefined}
    />
  );
}
