import Link from "next/link";

const links = [["/administration", "Overview"], ["/administration/organization", "Organization"], ["/administration/users", "Users"], ["/administration/branches", "Branches"], ["/administration/warehouses", "Warehouses"], ["/administration/locations", "Inventory Locations"], ["/administration/roles", "Roles & Permissions"]] as const;
export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
  return <div className="page-stack"><nav aria-label="Administration sections" className="scroll-tabs rounded-xl border bg-white p-2">{links.map(([href, label]) => <Link key={href} href={href} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium hover:bg-emerald-50 hover:text-[var(--brand)]">{label}</Link>)}</nav>{children}</div>;
}
