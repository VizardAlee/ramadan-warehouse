/** Match the inventory identifier normalization; never infer a serial from OCR. */
export function parseSaleSerials(value: string): string[] {
  return value.split(/\r?\n/).map(serial => serial.trim().replace(/\s+/g, " ").toUpperCase()).filter(Boolean);
}

export function validSaleSerials(serials: readonly string[], quantity: number, eligible?: readonly string[]): boolean {
  return serials.length === quantity && serials.length <= 50 && new Set(serials).size === serials.length &&
    serials.every(serial => serial.length <= 160 && (!eligible || eligible.includes(serial)));
}
