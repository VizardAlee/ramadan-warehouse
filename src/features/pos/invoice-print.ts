/** Fit the complete invoice to the printable height of A4 without clipping rows. */
export function fitInvoiceToPage(element: HTMLElement) {
  element.style.setProperty("--invoice-print-scale", "1");
  element.setAttribute("data-measure-print", "");
  const scale = Math.min(1, (260 * 96 / 25.4) / Math.max(1, element.scrollHeight));
  element.style.setProperty("--invoice-print-scale", String(scale));
  element.removeAttribute("data-measure-print");
}
