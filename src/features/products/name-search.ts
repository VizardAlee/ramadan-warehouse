/** Item searches deliberately match names, never SKUs, IDs or other metadata. */
export function normalizeProductName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

export function matchesProductName(name: string, query: string): boolean {
  return normalizeProductName(name).includes(normalizeProductName(query));
}
