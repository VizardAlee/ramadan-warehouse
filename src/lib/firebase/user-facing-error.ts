const messages: Record<string, string> = {
  PURCHASE_RECEIPT_RECONCILIATION_REQUIRED: "An older receipt has unresolved stock evidence. Check receiving history and ask authorized inventory/accounting staff to reconcile its goods-received note. Do not receive the same goods again.",
  RETRY_INSTRUCTIONS_MISMATCH: "This retry reference cannot confirm these instructions. Review the original saved request and transaction history; do not record the same stock or money again.",
  "functions/unauthenticated": "Your sign-in or device verification could not be confirmed. Refresh and try again; sign in again only if the app asks you to.",
  "functions/permission-denied": "This action is outside your current role or assigned location. Ask a system administrator to review access if it is part of your job; after an approved change, use Refresh authorization. Do not change accounts or locations just to bypass the check.",
  "functions/invalid-argument": "Some submitted information is invalid. Review the form and try again.",
  "functions/failed-precondition": "This action is not available in the record's current state. Refresh and review it.",
  "functions/aborted": "The record changed while you were working. Refresh and try again.",
  "functions/already-exists": "This record already exists.",
  "functions/not-found": "The requested record could not be found.",
  "functions/resource-exhausted": "Too many requests were made. Wait briefly and try again.",
  "functions/unavailable": "The service is temporarily unavailable. Check your connection and try again.",
  "auth/invalid-credential": "The email address or password is incorrect.",
  "auth/too-many-requests": "Too many sign-in attempts. Wait briefly before trying again.",
  "auth/network-request-failed": "Sign-in could not reach the service. Check your connection and try again.",
  STALE_POS_PRICE: "An offline sale uses an outdated price. Review and refresh it before posting.",
  POS_STOCK_RECONCILIATION_REQUIRED: "An offline sale exceeds current branch stock. A manager must reconcile stock before posting it.",
  CUSTOMER_CREDIT_LIMIT_EXCEEDED: "This sale exceeds the customer's currently available credit. Reduce the sale, collect a payment, or ask an administrator to review the limit.",
  EXCHANGE_CREDIT_UNAVAILABLE: "That exchange credit is no longer available or does not cover this amount. Refresh the POS and review the balance.",
  RETURN_SELF_APPROVAL_FORBIDDEN: "The person who submitted this return cannot approve it. Ask another authorized manager or administrator to review it.",
  PURCHASE_ORDER_SELF_APPROVAL_FORBIDDEN: "The person who created this purchase order cannot approve it. Ask another authorized purchasing approver.",
  SUPPLIER_INVOICE_SELF_APPROVAL_FORBIDDEN: "The person who entered this supplier invoice cannot approve it. Ask another authorized finance approver.",
  EXPENSE_SELF_APPROVAL_FORBIDDEN: "The person who entered this expense cannot approve it. Ask another authorized approver.",
  BANK_RECONCILIATION_SELF_APPROVAL_FORBIDDEN: "The person who prepared this bank reconciliation cannot complete it. Ask another authorized administrator or finance officer.",
  ACCOUNTING_CLOSE_SELF_APPROVAL_FORBIDDEN: "The person who prepared this accounting close cannot complete it. Ask another authorized administrator or finance officer.",
  BACKUP_NOT_VERIFIED: "A recent verified backup is required before starting fresh. Ask the backup operator to verify it; do not retry repeatedly or bypass this check.",
  ACCOUNTING_PERIOD_LOCKED: "That accounting month is prepared or closed. Use an open accounting date instead.",
  ACCOUNTING_CLOSE_BLOCKED: "This month is not ready to close. Review and resolve every blocker shown in the close workspace.",
  INVITATION_ALREADY_ACCEPTED: "This user has already activated the account, so a new invitation link cannot be issued. Use password recovery if they cannot sign in.",
  INVITATION_USER_INACTIVE: "Activate this user before issuing a new invitation link.",
};
const prerequisiteMessages: Record<string, string> = {
  "Select the active company financial account for this money line.": "Select the active company account matching this money-ledger code. Ask authorized banking staff to configure or reconcile the mapping if absent.",
  "This ledger code is shared by multiple financial accounts. Give each account its own code before posting manual money entries.": "Ask authorized banking staff and the accountant to reconcile this duplicated financial-account ledger mapping before posting. Do not create another journal to bypass the duplicate.",
  "The account picker requires paging before more than 500 ledger accounts can be used. No accounts were silently omitted.": "This register exceeds the supported account picker capacity. Ask the application administrator and accountant for supported paging. No accounts were silently omitted; repeating the same request cannot resolve the limit.",

  "Reconcile a shorter period containing at most 200 statement and ledger rows.": "Select a shorter reconciliation period containing at most 200 statement and ledger rows. Waiting or repeating the same range cannot resolve this limit.",
  "This period overlaps a closed bank reconciliation.": "Select a period that does not overlap a closed reconciliation. Ask authorized bank reconciliation staff to review the original period; do not rewrite closed evidence.",
  "Match every statement transaction in the period before preparing reconciliation.": "Match every statement transaction in the chosen period to its genuine ledger evidence before preparing reconciliation. Ask authorized reconciliation staff to investigate unmatched rows.",
  "Match every bank-ledger line in the period before preparing reconciliation.": "Match every bank-ledger line in the chosen period to the actual statement evidence. Ask finance to investigate missing statements; do not invent a match.",
  "Statement and bank-ledger movements do not agree.": "Ask authorized finance staff to investigate the difference between statement and ledger movements before preparing reconciliation. Do not alter evidence to force equality.",
  "A reconciliation match changed after preparation. Prepare it again.": "Refresh the current matches and prepare the reconciliation again before completing it. Ask authorized reconciliation staff to review the changed evidence.",
  "Receipt history exceeds this selector's 200-record source limit. No partial receipt list was returned.": "The receipt history exceeds the supported selector limit. No partial list was returned. Ask an authorized accountant to review original source evidence; repeatedly retrying cannot resolve this cap.",
  "Billing controls changed. Refresh and review the current mappings.": "Refresh and review the current billing mappings before saving your reviewed selection. The previous version has changed.",
  "Duplicate ledger codes require reconciliation before control mapping.": "Ask an authorized accountant to reconcile duplicate ledger codes before saving billing controls. Do not create another posting to resolve the duplicate.",
  "An account with existing postings cannot be repurposed as a billing control. Use a dedicated reviewed account.": "Select or have an authorized accountant create a dedicated reviewed liability account. Existing unrelated postings prevent repurposing this account as a billing control.",
  "A paged account selector is required. No accounts were silently omitted.": "This account register exceeds the supported selector capacity. Ask the application administrator and accountant to review paging support. No accounts were silently omitted; repeating the request cannot resolve the limit.",
  "This organization needs a paged account selector before manual journal entry. No accounts were silently omitted.": "Manual journal account selection exceeds the supported capacity. Ask the application administrator and accountant for supported paging. No accounts were silently omitted; do not post through another account to bypass it.",
  "The service balance requires reconciliation before another receipt or refund.": "Stop further receipts and refunds for this case. Ask an authorized accountant to reconcile the recorded service charge and original payment evidence.",
  "The original receipt journal requires reconciliation before refunding.": "Ask an authorized accountant to reconcile the original receipt journal before refunding. Do not invent a replacement receipt or collect/refund the money again.",
  "Service receipt tax allocation requires reconciliation before another payment.": "Ask an authorized accountant to reconcile the original service receipt and VAT allocation before recording another payment or refund.",
  "Customer balance evidence requires reconciliation.": "Ask an authorized accountant to reconcile the customer balance and original invoice/receipt evidence before recording this correction.",
  "Original receipt journal is missing.": "Ask an authorized accountant to review the original receipt and journal evidence before correction. Do not create a replacement journal just to bypass this check.",
  "Original receipt journal requires reconciliation before correction.": "Ask an authorized accountant to reconcile the original receipt journal before correcting it. Keep the original evidence and diagnostic code.",
  "Invoice debt and receipt evidence requires reconciliation.": "Ask an authorized accountant to reconcile invoice debt and original receipt evidence before correction. Do not change the charge to force a refund.",
  "This budget changed since you opened it. Refresh and review the latest version before saving.": "Refresh and review the latest budget target version before saving your reasoned revision. Preserve the other authorized change.",
  "An approved rule already covers this scope and period, or lacks a bounded end date. Reconcile its coverage before approving another version.": "Ask the authorized accountant to reconcile existing approved tax coverage and its bounded dates before approving another version. Do not guess a new effective period.",
  "An Authentication account already exists for this email. Use the documented recovery process; it was not attached.": "An existing sign-in identity uses this email. Ask a system administrator to verify the identity through approved recovery; do not create another invitation or silently attach the account.",
  "You cannot change your own access assignments or status.": "This user form cannot update your own access assignments or status. Ask another authorized user administrator to review and save the permitted change.",

  "Another active branch is already designated as head office.": "An active Head Office already exists. Choose Store / branch for this location, or ask the system administrator to review the current Head Office designation.",
  "Store assignment is unavailable.": "Choose an active assigned store. Ask a system administrator to configure or activate the correct store, then refresh the staff form.",
  "Linked app user must belong to this organization.": "Choose an app user in this organization. Ask an authorized user administrator to review the identity; do not link another organization's account.",
  "Staff ID cannot be changed after creation.": "Staff ID stays fixed after creation. Ask an HR administrator to review the original staff identity.",
  "Staff ID is already in use.": "This Staff ID is already used. Review the existing employee record or enter the new employee's unique real ID.",
  "Fingerprint connector ID is already assigned.": "That terminal attendance ID is assigned to another employee. Ask an HR administrator to verify the exact device mapping before changing either record.",
  "App user is already linked to another employee.": "This app user is already linked to another employee. Ask an HR administrator to review the current link; do not create a duplicate employee link.",
  "This role has over 100 users. Ask an administrator to schedule a controlled role migration.": "This role affects more than 100 users. Ask the system administrator to arrange a controlled role migration; waiting or repeating Save cannot resolve it.",
  "The location scope cannot change while users hold this role. Reassign them first.": "Reassign every user holding this role before changing its location scope. Ask an authorized role/user administrator to review the assignments.",
  "Reassign users before deactivating this role.": "Reassign every user holding this role before making it inactive. Ask an authorized role/user administrator to review the assignments.",
  "A user has another unavailable role. Resolve that assignment before changing this role.": "A member has another unavailable role. Ask the authorized user administrator to resolve that assignment before saving this role.",
  "A role with this name already exists.": "A role already uses this name. Review the existing role or choose a distinct role name.",
  "Only permissions available to the selected base role can be granted.": "Choose only permissions permitted by this role's base scope. Ask a system administrator to review the required role; do not expand the base merely to bypass access checks."
};
export class UserFacingError extends Error { constructor(message: string, readonly diagnosticCode?: string) { super(message); this.name = "UserFacingError"; } }
export function toUserFacingError(error: unknown, fallback = "The operation could not be completed. Refresh and try again."): UserFacingError {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  const details =
    typeof error === "object" &&
    error !== null &&
    "details" in error &&
    typeof error.details === "object" &&
    error.details !== null
      ? error.details
      : undefined;
  const operationCode =
    details && "code" in details && typeof details.code === "string"
      ? details.code
      : undefined;
  return new UserFacingError(
    (["STOCK_TRANSFER_ACTION_REQUIRED", "SUPPLIER_RETURN_ACTION_REQUIRED", "SALE_RETURN_ACTION_REQUIRED", "SALE_CORRECTION_ACTION_REQUIRED", "OPERATIONAL_EVIDENCE_ACTION_REQUIRED"].includes(operationCode ?? "") && details && "userMessage" in details && typeof details.userMessage === "string" ? details.userMessage : undefined) ??
    (code && ["functions/failed-precondition", "functions/already-exists", "functions/resource-exhausted", "functions/invalid-argument", "functions/permission-denied"].includes(code) && typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? prerequisiteMessages[error.message] : undefined) ??
    (operationCode && messages[operationCode]) ??
      (code ? messages[code] : undefined) ??
      fallback,
    operationCode ?? code,
  );
}
