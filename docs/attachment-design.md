# Attachment foundation

Binary uploads are deliberately disabled in Phase 5; `storage.rules` denies all access. A future implementation must use server-created random file IDs and scoped paths under `organizations/{organizationId}/{entityType}/{entityId}/{fileId}`. The server issues short-lived upload authorization only after entity access checks.

Metadata includes organization/entity/category, original and safe display name, MIME type, byte size, SHA-256, uploader, created/submitted timestamps, immutable-evidence flag, retention status, and soft-deletion record. Allow only reviewed image/PDF MIME types, reject executable/polyglot extensions, cap category size, and validate actual content after upload. Submitted evidence is immutable; downloads require fresh authorization. Malware scanning is not implemented and must be added or explicitly risk-accepted before enabling uploads.
