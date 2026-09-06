import Link from "next/link";
import { TransferList } from "@/features/transfers/transfer-list";
export default function LegacyTransfersPage() {
  return (
    <div className="page-stack">
      <Link href="/transfers" className="underline">
        ← Simple stock transfers
      </Link>
      <p className="rounded-xl bg-amber-50 p-4">
        Earlier transfers keep their original stock and delivery history.
        Continue their existing steps below. New everyday transfers use Request
        → Approve → Receive.
      </p>
      <Link href="/transfers/create/detailed" className="underline">
        Create an optional detailed logistics transfer
      </Link>
      <TransferList />
    </div>
  );
}
