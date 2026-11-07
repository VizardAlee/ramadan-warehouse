/** Fit ordinary invoices on A4 or Letter; paginate long invoices at readable size. */
export function fitInvoiceToPage(element: HTMLElement) {
  element.style.setProperty("--invoice-print-scale", "1");
  element.setAttribute("data-measure-print", "");
  try {
    // Letter is shorter than A4. Leave room for printer rounding and page headers.
    const fit = Math.min(1, (250 * 96 / 25.4) / Math.max(1, element.scrollHeight));
    // Never reduce a long invoice to illegible text just to claim one page.
    element.style.setProperty("--invoice-print-scale", String(fit >= 0.9 ? fit : 1));
  } finally {
    element.removeAttribute("data-measure-print");
  }
}
