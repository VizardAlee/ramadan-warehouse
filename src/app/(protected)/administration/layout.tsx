import Link from "next/link";

const links = [["/administration", "Overview"], ["/administration/organization", "Organization"], ["/administration/users", "Users"], ["/administration/branches", "Branches"], ["/administration/warehouses", "Warehouses"], ["/administration/locations", "Inventory Locations"], ["/administration/roles", "Roles & Permissions"]] as const;
export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6"><nav className="flex gap-2 overflow-x-auto rounded-xl border bg-white p-2">{links.map(([href, label]) => <Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium hover:bg-emerald-50 hover:text-[var(--brand)]">{label}</Link>)}</nav>{children}</div>;
}
