import Link from "next/link";
const links = [["/products", "Catalogue"], ["/products/categories", "Categories"]] as const;
export default function ProductsLayout({ children }: { children: React.ReactNode }) { return <div className="page-stack"><nav aria-label="Product sections" className="scroll-tabs rounded-xl border bg-white p-2">{links.map(([href, label]) => <Link key={href} href={href} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium hover:bg-emerald-50">{label}</Link>)}</nav>{children}</div>; }
