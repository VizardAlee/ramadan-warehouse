# UI/UX guidelines

## Audit summary

The production UI review covered the application shell, login, dashboard, administration, catalogue, inventory, requests, transfers, costs, reconciliation, reports, and audit routes. The initial implementation relied on desktop-first two-column grids, wide tables, inconsistent headings and button sizing, small tablet navigation, placeholder dashboard/audit destinations, basic loading/empty states, and feature-specific status treatments. Several dialogs were desktop panels squeezed into a phone viewport, and callable failures could expose low-level Firebase messages.

The hardening pass preserves callable boundaries, permissions, workflow state machines, inventory accounting, and all server-side security. UI validation uses the local Firebase emulator only; production business data is never used as design fixture data.

## Layout and navigation

- Page gutters and section gaps use fluid `clamp()` tokens. Operational pages may use all available content width; they are not constrained to a marketing-page column.
- Cards, filters, and forms use intrinsic `auto-fit/minmax()` grids so intermediate widths remain balanced.
- At 1280px and above the full persistent sidebar shows labels and organization context. From 768px to 1279px a compact icon sidebar preserves workspace access. Below 768px the shell provides an app header, a focus-trapped drawer for secondary navigation, and a safe-area-aware bottom bar for Dashboard, Products, Inventory, Requests, Transfers, and More.
- Navigation is never hover-only. Interactive controls target at least 44px, expose visible focus, and retain text or accessible labels.

## Typography, surfaces, and actions

- `page-title`, `section-title`, and `page-description` provide a restrained fluid hierarchy. Numeric KPIs use tabular numerals.
- `surface`, `card-grid`, `form-grid`, `filter-grid`, and `action-row` are the shared layout vocabulary.
- Button variants are primary, secondary, outline, destructive, and ghost, with standard and icon sizes, disabled styling, and touch-safe height.
- Status badges use a centralized semantic tone map, a text label, and a status dot. Color is supplementary rather than the only state cue.
- Long operational identifiers use controlled wrapping or ellipsis with their full value available through the native title affordance where applied.

## Forms, feedback, and dialogs

- Forms flow from one column into balanced intrinsic columns when each field has adequate width. Labels remain visible; numeric, email, and phone inputs retain appropriate browser input modes.
- Mutating controls retain existing permission checks and server validation. Submitting controls disable while a request is in flight.
- User-facing callable errors map stable Firebase codes to actionable, non-technical messages; diagnostic error codes remain available to the application error path.
- Empty, warning, error, loading, and offline states share consistent components. The dashboard does not wait on nonexistent callables and shows a scoped warning if a summary source cannot load.
- Editing dialogs become full-width bottom sheets on small screens and bounded dialogs on larger screens. Content scrolls independently, action rows remain reachable, Escape closes, focus stays within the surface, and focus returns to the opener.
- Destructive workflow actions continue to use their explicit reason/consequence forms. Generic browser `confirm()` is not used.

## Responsive table/deck pattern

Desktop retains semantic tables for dense operational comparison. Below 768px, the shared responsive-table pattern turns each row into a structured two-column record card using `data-label`; the primary identity and action area span the card. Critical status, quantities, references, costs, and actions remain present. Loading/empty rows span the card rather than masquerading as records.

The pattern is applied to users, administrative master data, products, stock balances, serial assets, stock counts, product stock/history, requests, request items and reports, transfers, transfer items/costs/queues, inventory reports, and audit history. The stock-count workspace retains a contained scroll region because it is an editing grid inside a bounded sheet; the page itself never scrolls horizontally.

## Accessibility and mobile workflow baseline

- Semantic headings, table headers, labels (including screen-reader labels for compact filters), `role=alert`, meaningful button labels, and non-color status labels are required.
- Focus indicators are global. Drawers and editing sheets trap focus, support Escape, restore focus, and declare dialog semantics.
- Reduced-motion preference disables nonessential transitions and animation.
- Warehouse actions prioritize visible quantities, location context, status, and touch-safe actions. Details use stacked KPI cards before dense item history on phones.

## PWA conventions

The manifest identifies AB Ramadan Warehouse, uses standalone display, the production brand palette, and the repository warehouse icon. Viewport configuration supports device safe areas. Standalone layout accounts for top/bottom safe-area insets. An offline banner clearly states that authoritative workflow confirmations require connectivity; trusted writes remain server-controlled.

## Content-driven decisions

The major navigation/table transition occurs below 768px because the operational tables become impractical before phone width, while the compact sidebar is still effective on portrait tablet. Intrinsic card/form grids provide the intermediate adaptations from 360px through wide desktop. Feature-specific horizontal tab strips are contained and touch-scrollable; they do not cause page-level overflow.
