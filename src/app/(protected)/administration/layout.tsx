import { PermissionTabs } from "@/components/layout/permission-tabs";

const tabs = [
  { href: "/administration", label: "Overview", permissions: ["organization.manage", "branch.manage", "warehouse.manage", "location.manage", "user.manage", "role.manage"] },
  { href: "/administration/organization", label: "Organization", permissions: ["organization.manage"] },
  { href: "/administration/users", label: "Users", permissions: ["user.manage"] },
  { href: "/administration/branches", label: "Branches", permissions: ["branch.manage"] },
  { href: "/administration/warehouses", label: "Warehouses", permissions: ["warehouse.manage"] },
  { href: "/administration/locations", label: "Inventory Locations", permissions: ["location.manage"] },
  { href: "/administration/roles", label: "Roles & Permissions", permissions: ["role.manage"] },
] as const;
export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
  return <div className="page-stack"><PermissionTabs label="Administration sections" tabs={tabs} />{children}</div>;
}
