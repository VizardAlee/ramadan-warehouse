/** Item searches deliberately match names, never SKUs, IDs or other metadata. */
export function normalizeProductName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

export function matchesProductName(name: string, query: string): boolean {
  const compact = (value: string) => normalizeProductName(value).replace(/[\s\p{P}]+/gu, "");
  return compact(name).includes(compact(query));
}
