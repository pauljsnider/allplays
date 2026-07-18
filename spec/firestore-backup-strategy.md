# Firestore Backup Strategy

Firestore recovery is configured in Google Cloud rather than `firebase.json`.
The production database now has PITR, delete protection, and a daily managed
backup retained for 14 days. The repository verifies that external posture in
`.github/workflows/firestore-recovery-health.yml`; operational recovery steps
and drill evidence belong in `docs/firestore-recovery-runbook.md`.

The first PITR clone drill completed successfully on 2026-07-18. The clone
matched representative top-level and nested collection counts and was deleted
without changing or redirecting the production database. The exact operation,
counts, and cleanup evidence are recorded in the runbook.

## Goals

- Recover from accidental deletes/updates (bad client code, bad rules, operator error).
- Be able to restore specific collections or the entire database.
- Keep operational cost and complexity reasonable.

## Implemented Approach

### 1) Enable Firestore Managed Backups / PITR (Primary)

Use Firestore managed backups and point-in-time recovery (PITR).

Why:

- Best protection against accidental deletes/overwrites.
- No extra code paths required in this repo.
- Faster and more reliable than building a custom export pipeline.

Notes:

- Configure retention based on how quickly you want to detect issues (typical: 7-30 days).
- Document the restore workflow and who has permission to run restores.

### 2) Scheduled Exports to Cloud Storage (Optional longer retention)

Set up a scheduled Firestore export to a Cloud Storage bucket (daily or weekly).

Why:

- Longer retention windows (e.g., 90-365 days) at lower cost than keeping PITR for that long.
- Offline copy that can be used for analytics or emergency migration.

Implementation options (outside this repo unless we add infra code):

- Cloud Scheduler -> Cloud Run job (or Cloud Function) -> Firestore export API
- Terraform (preferred if you want this reproducible/config-as-code)

Export scope:

- Full export (simplest), or
- Collection-level exports if you want to reduce cost/size (requires discipline to keep a list).

## Restore Playbook

See `docs/firestore-recovery-runbook.md` for the clone/restore commands,
approval boundary, cleanup steps, and validation checklist.

## Minimum Operational Checklist

- Run `npm run ops:verify-firestore-recovery`
- Confirm a Storage bucket exists for exports (if doing scheduled exports)
- Confirm IAM roles for the account that runs exports/restores
- Confirm alerts/notifications for failed exports (if scheduled exports exist)

## Why This Matters For Data Privacy

Firestore rules are document-level (no field-level redaction). If we keep sensitive
fields (e.g., `medicalInfo`, `emergencyContact`) in documents that are readable to
many users (or publicly readable), those fields are exposed.

If/when we tighten privacy, the recommended pattern is:

- Public player doc: `teams/{teamId}/players/{playerId}` (name/number/photo and other safe fields)
- Private player subcollection doc: `teams/{teamId}/players/{playerId}/private/profile`
  (sensitive fields, locked down by rules)

This also makes future backups/restores more obviously sensitive: restoring private
data should be more tightly controlled.
