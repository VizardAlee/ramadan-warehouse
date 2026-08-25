# Progressive Web App and device support

AB Ramadan Warehouse is an installable Progressive Web App for current Chrome
and Safari releases on phones, tablets, and desktop computers. The same web
release remains usable in a normal browser tab.

## Installation

- Chrome and other Chromium browsers use the in-app Install button when the
  browser exposes its install prompt.
- Safari on iPhone and iPad uses Share, then Add to Home Screen. The in-app
  Install button shows those steps.
- Safari on macOS uses File, then Add to Dock. The in-app Install button shows
  that platform-specific instruction.
- The manifest provides 192px, 512px, maskable, shortcut, and 180px Apple touch
  icons. Standalone mode uses the ABR brand colors and safe-area-aware layout.

The app detects a waiting service-worker release and exposes an Update button.
The update activates only after the user chooses it, preventing a checkout or
form from being unexpectedly replaced mid-operation.

## Offline boundary

The service worker is registered globally, but it does not turn every workflow
into an offline workflow. It precaches only the offline page, manifest, and app
icons; it caches versioned Next.js assets as they are used. Normal navigation
is network-first. Arbitrary protected HTML, Firebase requests, callable
requests, authentication responses, and business data are never placed in the
service-worker cache.

The POS page shell is the single protected runtime page cached after a
successful online visit. Its business catalogue, open shift, and queued sales
remain in the existing user-and-branch-keyed IndexedDB store. Server-confirmed
stock, payments, VAT, journals, invoices, and receipts are still posted only
through authenticated, App Check-enforced callables. Other offline routes show
the dedicated reconnect page and do not enable mutations.

Cache cleanup deletes only caches owned by this application (`abr-*`). It does
not delete Firebase or unrelated browser caches.

## Responsive baseline

- Below 1280px, phones and tablets use safe-area-aware bottom navigation.
- At 1280px and above, desktop uses the persistent full navigation.
- Tables become record cards below 768px; forms and cards use intrinsic fluid
  grids between phone, tablet, and desktop widths.
- Controls meet a 44px touch baseline. Mobile form fields use a 16px minimum
  font size to avoid unintended Safari input zoom.
- The viewport supports display cutouts and the on-screen keyboard without
  disabling user zoom.
