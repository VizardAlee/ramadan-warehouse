# HR attendance foundation

`employees` is a separate organization-scoped staff register. An employee need not have a Firebase Authentication user. An optional `userId` links one app account to one employee, while `externalAttendanceId` maps an external fingerprint terminal's staff code. Neither identifier grants app permissions.

System administrators can maintain versioned monthly salary terms in `employeeCompensationVersions`; the current snapshot is `employeeCompensation/{employeeId}`. This is a salary register, **not payroll processing**: it does not calculate deductions, payslips, liabilities or disburse money. Operations administrators can maintain staff and manual attendance but cannot read compensation by default. Firestore denies all direct client access; callables check the union of active assigned roles and organization. Changes are audited.

`attendanceEvents` is append-only and records clock-in/out, source, event time, ingest time, employee and store. Manual corrections require a reason. `ingestExternalAttendance` is the internal idempotent adapter contract for a future fingerprint connector. It resolves a device staff ID through `employeeExternalIds`, records a deterministic event, and writes an audit entry. It never receives or stores fingerprint images/templates. It is deliberately **not a public HTTP endpoint**: device credentials, payload protocol, networking and Cloud Run invocation policy must be selected against the actual scanner model before enabling an external adapter. Do not give a scanner administrator Firebase credentials.

The HR page also keeps append-only dated staff activities (leave, training, performance, incident, notes). Employee tables use server-side cursor paging with 25/50/100 rows. Recent attendance and activity panels show the latest 25 events; fuller date-range reports and payroll calculations are later work.

## Connecting a fingerprint terminal

The in-app HR checklist is a preparation guide, not a claim that every scanner is plug-and-play. Before an adapter can be activated:

1. Create the employee records, including staff without app accounts, and assign their store.
2. Enrol staff on the terminal. Set each employee's `externalAttendanceId` to the terminal's exact user ID; the app rejects duplicate IDs within the organization. Do not copy fingerprint images or templates into the app.
3. Obtain the terminal make, model, firmware, vendor API/SDK or export format, connectivity/gateway method, time-zone behaviour, and a sample clock-in/clock-out event from the installer. Do not put passwords or API keys in HR notes.
4. Build/configure a vendor-specific, authenticated connector outside the browser. It should map a stable device ID and event ID to `ingestExternalAttendance`, handle retries without duplicate events, and store any device secrets in a managed secret store. The internal function is not itself a device-facing endpoint.
5. Test one clock-in and one clock-out for a mapped employee; verify the HR attendance list shows source **Fingerprint connector**, correct employee, store and time. Test an unknown ID, duplicate event, and network interruption before relying on the feed.

Until steps 3–5 are completed for the actual scanner model, device sync is **not connected**. Manual attendance corrections remain available and auditable. A device make/model and its integration documentation or sample export are required to finish the connector; there is no safe universal setup URL or credential that can be supplied in advance.
