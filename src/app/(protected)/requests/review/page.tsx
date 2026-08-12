import { RequestList } from "@/features/requests/request-list";
export default function ReviewQueuePage() {
  return <RequestList initialStatus="submitted" />;
}
