import { PermissionTabs } from "@/components/layout/permission-tabs";

const tabs = [
  { href: "/products", label: "Catalogue", permissions: ["products.read"] },
  {
    href: "/products/categories",
    label: "Categories",
    permissions: ["products.create", "products.update"],
  },
] as const;

export default function ProductsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="page-stack">
      <PermissionTabs label="Product sections" tabs={tabs} />
      {children}
    </div>
  );
}
