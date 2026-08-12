import Link from "next/link";
const links = [["/products", "Catalogue"], ["/products/categories", "Categories"]] as const;
export default function ProductsLayout({ children }: { children: React.ReactNode }) { return <div className="space-y-6"><nav className="flex gap-2 rounded-xl border bg-white p-2">{links.map(([href, label]) => <Link key={href} href={href} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-emerald-50">{label}</Link>)}</nav>{children}</div>; }
