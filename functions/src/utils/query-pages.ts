import { FieldPath } from "firebase-admin/firestore";

/** Stable server-side pages; callers aggregate each page instead of retaining the ledger. */
export async function visitQueryPages(
  query: FirebaseFirestore.Query,
  visit: (documents: FirebaseFirestore.QueryDocumentSnapshot[]) => void | Promise<void>,
  options: { orderField?: string; orderDirection?: "asc" | "desc"; pageSize?: number } = {},
) {
  const pageSize = options.pageSize ?? 500;
  const direction = options.orderDirection ?? "asc";
  let ordered = options.orderField ? query.orderBy(options.orderField, direction) : query;
  ordered = ordered.orderBy(FieldPath.documentId(), direction);
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (cursor ? ordered.startAfter(cursor) : ordered).limit(pageSize).get();
    if (page.empty) return;
    await visit(page.docs);
    if (page.size < pageSize) return;
    cursor = page.docs.at(-1);
  }
}
