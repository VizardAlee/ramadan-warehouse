import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) { return <span aria-hidden className={cn("block animate-pulse rounded-md bg-slate-200", className)}/>; }
export function RecordSkeleton({ count = 3 }: { count?: number }) { return <div aria-label="Loading records" role="status" className="grid gap-3">{Array.from({ length: count }, (_, index) => <div key={index} className="rounded-xl border bg-white p-4"><Skeleton className="h-4 w-2/3"/><Skeleton className="mt-3 h-3 w-1/2"/><div className="mt-5 grid grid-cols-2 gap-3"><Skeleton className="h-10"/><Skeleton className="h-10"/></div></div>)}</div>; }
