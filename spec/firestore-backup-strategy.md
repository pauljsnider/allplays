# Firestore Backup Strategy

This repo (static site + Firebase) does not encode Firestore backup behavior.
Backups for Firestore are configured in Google Cloud (the Firebase project), not in
`firebase.json` / `firestore.rules` / `firestore.indexes.json`.

## Goals

- Recover from accidental deletes/updates (bad client code, bad rules, operator error).
- Be able to restore specific collections or the entire database.
- Keep operational cost and complexity reasonable.

## Recommended Approach

### 1) Enable Firestore Managed Backups / PITR (Primary)

Use Firestore managed backups / point-in-time recovery (PITR) in the GCP Console.

Why:

- Best protection against accidental deletes/overwrites.
- No extra code paths required in this repo.
- Faster and more reliable than building a custom export pipeline.

Notes:

- Configure retention based on how quickly you want to detect issues (typical: 7-30 days).
- Document the restore workflow and who has permission to run restores.

### 2) Scheduled Exports to Cloud Storage (Secondary, for longer retention)

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

## Restore Playbook (What We Should Document)

- When to use PITR restore vs export restore
- Who can approve/execute a restore
- Expected downtime / impact on the app
- Post-restore validation checklist (sample queries, key pages to load)

## Minimum Operational Checklist

- Confirm PITR/managed backups are enabled in the Firebase project
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

