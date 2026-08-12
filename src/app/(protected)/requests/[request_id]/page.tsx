"use client";
import { useParams } from "next/navigation";
import { RequestDetail } from "@/features/requests/request-detail";
export default function RequestDetailPage() {
  const { request_id: requestId } = useParams<{ request_id: string }>();
  return <RequestDetail requestId={requestId} />;
}
