import { Suspense } from "react";
import { RequestForm } from "@/features/requests/request-form";
export default function CreateRequestPage() {
  return (
    <Suspense fallback={<div>Loading request form…</div>}>
      <RequestForm />
    </Suspense>
  );
}
