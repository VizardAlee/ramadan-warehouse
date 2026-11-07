# Complete printable documents

The print layout uses the selected paper's printable width and normal document flow. Dialog scroll areas, fixed positioning and mobile table cards must not crop the document.

- Ordinary sales invoices, receipts, proformas, vouchers and collection waybills fit on one portrait A4 or Letter page when their content fits.
- All invoice columns, line items, payment evidence and totals remain in the document. Long invoices paginate with repeated column headings instead of being clipped or reduced to unreadable text.
- Invoice fitting applies only a modest scale adjustment (at least 90% of the 12px print font). Larger documents keep their normal readable size.
- Customer and supplier account statements retain their full-width A4 landscape layout and page naturally.
- Financial-privacy controls and the explicit actual-value review before printing are unchanged. Printing never creates stock or financial transactions.

## Verification

Synthetic component-rendered fixtures were printed with Chrome for A4 and Letter: 3- and 15-item invoices and the ordinary receipt, proforma, voucher and waybill fit one page. 35-item invoices use two pages. 100-item invoices use three A4 or four Letter pages with every item preserved. A long eight-column landscape statement retains all rows and closing balances.

UI regression tests retain full product names separately from SKUs through inventory refresh and location changes. The reported missing-name issue was not reproduced in the current live Stock overview for Civic Center or Igbo Road; a screenshot of the affected inventory tab/device is needed to identify any remaining case.

Physical printers and user-selected paper size, margins, headers and scaling can affect pagination. Use the matching paper size in the print dialog and review the preview before printing.
