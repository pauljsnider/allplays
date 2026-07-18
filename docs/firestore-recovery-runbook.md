# Firestore recovery runbook

The production `game-flow-c6311/(default)` database has three independent
recovery controls:

- seven-day point-in-time recovery (PITR);
- database delete protection; and
- a daily managed backup retained for at least 14 days.

The scheduled `firestore-recovery-health` workflow checks those controls every
six hours. It accepts only an exact `READY` backup from the current database UID and
fails if the newest usable backup is more than 36 hours old. A genuinely new
daily schedule receives one 36-hour first-backup grace window. Production is
pinned to backup schedule
`projects/game-flow-c6311/databases/(default)/backupSchedules/8a7f67fe-c6eb-4a4e-8a48-20e96e9fdf57`;
its original creation time is pinned to `2026-07-18T02:42:05.213778Z`.
Recreating or replacing that schedule fails verification instead of resetting
the grace window. A backup must have its own valid `snapshotTime`; a backup's
`createTime` is never accepted as a freshness substitute. Missing,
malformed, stale, wrong-lineage, or materially future metadata fails closed.
Every usable backup must have the exact database resource, a canonical backup
resource name, the current UUIDv4 database UID, and a valid `expireTime` beyond
the next six-hour health-check window; an already-expired or imminently expiring
backup is not counted as restorable evidence.
Google timestamps must be valid UTC RFC 3339 values; only ten minutes of normal
clock skew is tolerated before a future schedule or backup fails the check.

## Keyless health-check identity

The workflow must use GitHub OIDC through Google Workload Identity Federation.
Do not create or store a service-account JSON key for this job. The workflow
preflight refuses missing configuration, a non-canonical provider name, a
service account from another project, a repository other than
`pauljsnider/allplays`, a ref other than `refs/heads/master`, or a different
workflow path before it asks Google for credentials. The Google trust boundary
uses GitHub's immutable numeric repository and owner IDs, not reusable
repository or account names.

The metadata reader needs a project-level custom role containing exactly:

- `datastore.databases.getMetadata`;
- `datastore.backupSchedules.list`; and
- `datastore.backups.list`.

The GitHub identity needs `roles/iam.workloadIdentityUser` on only the dedicated
service account. It does not need Service Account Token Creator, application
document reads, restore permissions, deploy permissions, or any database write.

### External provisioning inputs

Provisioning lives outside this repository. The following resources were
reconciled and verified in production on 2026-07-18; future operators must
compare this exact desired state rather than blindly creating duplicates:

| Input | Exact desired value |
| --- | --- |
| Google Cloud project ID | `game-flow-c6311` |
| Google Cloud project number | `982493478258` |
| Custom role ID | `allplaysFirestoreRecoveryMetadataViewer` |
| Service account ID | `allplays-firestore-recovery` |
| Service account email | `allplays-firestore-recovery@game-flow-c6311.iam.gserviceaccount.com` |
| Workload Identity pool ID | `github-actions` |
| Workload Identity provider ID | `allplays-recovery` |
| GitHub repository | `pauljsnider/allplays` |
| Immutable GitHub repository ID | `1106220007` |
| Immutable GitHub repository-owner ID | `211066188` |
| Allowed Git ref | `refs/heads/master` |
| Allowed workflow ref | `pauljsnider/allplays/.github/workflows/firestore-recovery-health.yml@refs/heads/master` |

The provider must map `google.subject=assertion.sub`,
`attribute.repository_id=assertion.repository_id`,
`attribute.repository_owner_id=assertion.repository_owner_id`,
`attribute.ref=assertion.ref`, and
`attribute.workflow_ref=assertion.workflow_ref`. Its attribute condition must
require both immutable IDs plus the exact ref and workflow above. Bind
`roles/iam.workloadIdentityUser` to this member and no broader pool member:

```text
assertion.repository_id == '1106220007' && assertion.repository_owner_id == '211066188' && assertion.ref == 'refs/heads/master' && assertion.workflow_ref == 'pauljsnider/allplays/.github/workflows/firestore-recovery-health.yml@refs/heads/master'
```

```text
principalSet://iam.googleapis.com/projects/982493478258/locations/global/workloadIdentityPools/github-actions/attribute.repository_id/1106220007
```

Set these non-secret variables on the GitHub `production` environment:

```text
FIRESTORE_RECOVERY_WORKLOAD_IDENTITY_PROVIDER=projects/982493478258/locations/global/workloadIdentityPools/github-actions/providers/allplays-recovery
FIRESTORE_RECOVERY_SERVICE_ACCOUNT=allplays-firestore-recovery@game-flow-c6311.iam.gserviceaccount.com
```

The immutable repository-ID principal set and provider condition are the
security boundary; the exact ref and workflow are additional constraints. Verify the
condition and role permissions in Google Cloud, verify that no user-managed key
exists on the dedicated service account, then run a manual workflow dispatch
from `master` after this workflow is merged. The 2026-07-18 provisioning audit
found the pool/provider `ACTIVE`, exactly three custom-role permissions, only
the repository-ID `workloadIdentityUser` principal, zero user-managed keys, and
both exact GitHub production-environment variables. The first workflow dispatch
and scheduled heartbeat still must succeed before monitoring is called active.

## Verify the recovery posture manually

Authenticate `gcloud` as the dedicated metadata reader through an approved
keyless method, then run:

```bash
export ALLPLAYS_FIRESTORE_PROJECT_ID='YOUR_PROJECT_ID'
npm run ops:verify-firestore-recovery -- --project="$ALLPLAYS_FIRESTORE_PROJECT_ID"
```

The command prints only recovery metadata. It does not read application
documents or mutate a database. `--max-backup-age-hours` is limited to a finite
value from 1 through 168 hours so a typo such as `Infinity`, `NaN`, `0`, or an
unreasonably large threshold cannot silently disable freshness monitoring.

## Health-check failure

The verification job has a ten-minute timeout; each `gcloud` read has a
two-minute timeout. A separate downstream job runs after ordinary verification
failure or job timeout, emits an error annotation, writes immediate response
steps to the run summary, and fails the workflow. It never changes cloud state.

Treat any failure as "recovery posture unverified" until proved otherwise:

1. Inspect the failed command and determine whether the cause is OIDC/IAM,
   malformed API output, or an actual posture failure.
2. Re-run the read-only verifier using an approved metadata-reader identity.
3. If PITR, delete protection, the daily schedule, retention, backup lineage, or
   freshness is wrong, open a production incident and page the production
   owner. Do not wait for the next scheduled run.
4. Do not disable or recreate a recovery control to clear the alert. Preserve
   metadata and determine why it changed.
5. If the failure is authentication-only, repair the exact OIDC trust and rerun
   the workflow; do not substitute deploy credentials or a JSON key.

The failure summary is not an out-of-band pager. The repository owner must route
failures from the `firestore-recovery-health` workflow to the production on-call
destination and exercise that notification before calling monitoring complete.

The separate status job has only `contents: read` and `issues: write`. On a
failed, cancelled, skipped, or timed-out verification it creates or reopens one
marker-protected issue titled `[Recovery] Firestore recovery posture is
unverified`, assigns it to `pauljsnider`, applies the `recovery-monitor` label,
and updates it with the exact run URL. It closes that managed issue only after a
later successful verification. Before any update, reopen, or close, the
reconciler requires exact REST author ID `41898282`, login
`github-actions[bot]`, type `Bot`, the bot-only label, and the management marker.
The server-side search is restricted to the unforgeable `app/github-actions`
author, so public-user title/marker copies are ignored and cannot suppress the
managed incident. Duplicate bot-authored exact-title issues, incomplete search
results, result-count mismatches, or identity mismatches fail closed without
editing an untrusted issue.

That issue handles explicit workflow failures but is not a dead-man. An external
read-only watcher must query the exact workflow's latest `event=schedule` run
and alert if there is no successful completion within the exercised heartbeat
window, the workflow returns 404, or the API repeatedly fails. The watcher must
live outside this repository's GitHub Actions so deleting/disablement cannot
silence both monitors. Do not call recovery monitoring complete until that
external route has been exercised.

## Point-in-time recovery drill

Never restore over `(default)`. A drill creates a separate, temporary database
from a whole-minute PITR timestamp:

```bash
export ALLPLAYS_FIRESTORE_PROJECT_ID='YOUR_PROJECT_ID'
export ALLPLAYS_PITR_DRILL_DATABASE='restore-drill-YYYYMMDD-abcdef'
printf '%s' "$ALLPLAYS_PITR_DRILL_DATABASE" | grep -Eq '^restore-drill-[0-9]{8}-[a-z0-9]{6}$'
# Require an exact describe of this destination to return NOT_FOUND first.
gcloud firestore databases clone \
  --project="$ALLPLAYS_FIRESTORE_PROJECT_ID" \
  --source-database="projects/$ALLPLAYS_FIRESTORE_PROJECT_ID/databases/(default)" \
  --snapshot-time='YYYY-MM-DDTHH:MM:00Z' \
  --destination-database="$ALLPLAYS_PITR_DRILL_DATABASE"
```

Use the returned operation name to monitor the clone:

```bash
gcloud firestore operations describe 'OPERATION_NAME' \
  --project="$ALLPLAYS_FIRESTORE_PROJECT_ID" \
  --format='yaml(done,error,metadata.operationState,metadata.progressPercentage)'
```

Wait until `done` is true and `metadata.operationState` is `SUCCESSFUL`. Stop if
the operation reports an error, failure, or cancellation. Compare counts and
deterministic field checksums for representative top-level and nested documents
before deleting the isolated drill database. Freeze the returned destination
name and UID from that exact operation; revalidate both immediately before
cleanup. Use the managed-backup section's guarded delete-protection and final
ETag cleanup pattern, substituting the exact clone source and
`restore-drill` ID regex. Never reuse a prior drill ID or directly delete by
name alone.

## Managed-backup restore drill

Status: **tested successfully on 2026-07-18**; evidence is recorded below. A
`READY` backup and a documented schedule alone do not prove the restore path.
Repeat this independent drill at least quarterly after OIDC
health monitoring is operational. The drill executor must use a separate,
time-limited elevated identity approved for restore and temporary-database
deletion; never grant those permissions to the health-check service account.

### 1. Freeze exact inputs

Record the selected backup resource name, its `snapshotTime`, `database`,
`databaseUid`, and exact `READY` state. Confirm its UID matches the current
source database UID. Generate a unique destination such as
`backup-drill-20260718-a1b2c3`, require it to match
`^backup-drill-[0-9]{8}-[a-z0-9]{6}$`, and prove `databases describe` returns
`NOT_FOUND` before starting. Never reuse an existing database.

```bash
export ALLPLAYS_FIRESTORE_PROJECT_ID='YOUR_PROJECT_ID'
export ALLPLAYS_BACKUP_RESOURCE='projects/YOUR_PROJECT_ID/locations/LOCATION/backups/BACKUP_ID'
export ALLPLAYS_BACKUP_SNAPSHOT_TIME='YYYY-MM-DDTHH:MM:SS.ffffffZ'
export ALLPLAYS_BACKUP_DRILL_DATABASE='backup-drill-YYYYMMDD-abcdef'

gcloud firestore databases restore \
  --project="$ALLPLAYS_FIRESTORE_PROJECT_ID" \
  --source-backup="$ALLPLAYS_BACKUP_RESOURCE" \
  --destination-database="$ALLPLAYS_BACKUP_DRILL_DATABASE"
```

Monitor the exact returned operation until it is done and successful. Do not
validate or delete while the restore is pending.

### 2. Compare deterministic sample checksums

Counts alone can miss corrupted field values. Before restoring, select at least
five stable source documents spanning `users`, `teams`, `accessCodes`, and a
nested team collection. For every selected document:

1. fetch the source document through the Firestore REST API using the elevated
   drill identity;
2. require its `updateTime` to be at or before the selected backup
   `snapshotTime`—otherwise it is not valid evidence for that backup;
3. canonicalize only the REST document's `fields` object with `jq -cS`;
4. compute SHA-256 over those canonical bytes; and
5. record `documentPath<TAB>sha256` in a temporary manifest sorted bytewise by
   exact path.

After the restore succeeds, fetch those exact paths from the isolated database,
canonicalize and hash them identically, sort the restored manifest, and require
both `cmp` of the manifests and the SHA-256 of the complete manifests to match.
Keep exact paths only in the restricted temporary workspace or sealed operator
evidence. Before committing drill evidence, replace every access-code document
ID with `[redacted]`; the ID is itself a redeemable secret, so do not print it,
commit it, or preserve it in reversible encoding. Do not print field values or
store raw document JSON in drill evidence. Record only redacted path labels,
per-document hashes, aggregate manifest hash, counts, backup resource, database
UID, snapshot time, restore operation, and result.

For example, the canonical field hash for a fetched document is:

```bash
jq -ceS '.fields // {}' exact-document.json | openssl dgst -sha256 | awk '{print $2}'
```

Use a fresh temporary directory created with `mktemp -d` for raw responses,
restrict it to the operator, and remove it after the evidence manifest is
sealed. A missing document, REST error, invalid JSON, source `updateTime` after
the backup snapshot, empty sample, or hash mismatch fails the drill. Counts
captured from the live source after the backup are contextual inventory, not
snapshot-consistent proof: record and investigate count drift, but fail on a
count mismatch only when both counts refer to the same snapshot. Do not redirect
production traffic to the drill database.

### 3. Delete only the exact isolated target

Deletion requires an explicit resource-name guard. Set an immutable expected
value from the recorded drill plan, reject `(default)`, reject an invalid drill
ID, and compare the described resource name before deletion:

```bash
set -euo pipefail
readonly EXPECTED_BACKUP_DRILL_DATABASE='backup-drill-YYYYMMDD-abcdef'
readonly EXPECTED_BACKUP_RESOURCE='projects/YOUR_PROJECT_ID/locations/LOCATION/backups/BACKUP_ID'
readonly EXPECTED_BACKUP_DRILL_UID='UID_FROM_EXACT_COMPLETED_RESTORE_OPERATION'
readonly EXPECTED_BACKUP_RESTORE_OPERATION='EXACT_RESTORE_OPERATION_RECORDED_AND_MONITORED_ABOVE'
readonly EXPECTED_SOURCE_DATABASE_UID='SOURCE_UID_RECORDED_BEFORE_RESTORE'
test "$ALLPLAYS_BACKUP_DRILL_DATABASE" = "$EXPECTED_BACKUP_DRILL_DATABASE"
test "$ALLPLAYS_BACKUP_DRILL_DATABASE" != '(default)'
printf '%s' "$ALLPLAYS_BACKUP_DRILL_DATABASE" | grep -Eq '^backup-drill-[0-9]{8}-[a-z0-9]{6}$'

target_before_json="$(gcloud firestore databases describe \
  --project="$ALLPLAYS_FIRESTORE_PROJECT_ID" \
  --database="$ALLPLAYS_BACKUP_DRILL_DATABASE" \
  --format=json)"
actual_resource="$(jq -r '.name' <<< "$target_before_json")"
actual_uid="$(jq -r '.uid' <<< "$target_before_json")"
actual_etag="$(jq -r '.etag' <<< "$target_before_json")"
actual_source_backup="$(jq -r '.sourceInfo.backup.backup' <<< "$target_before_json")"
test "$actual_resource" = "projects/$ALLPLAYS_FIRESTORE_PROJECT_ID/databases/$EXPECTED_BACKUP_DRILL_DATABASE"
test "$actual_uid" = "$EXPECTED_BACKUP_DRILL_UID"
test -n "$actual_etag"
test "$actual_source_backup" = "$EXPECTED_BACKUP_RESOURCE"

# Re-read the exact restore operation that was recorded and monitored above.
# Database.sourceInfo.progress is not part of the documented cleanup contract.
restore_operation_json="$(gcloud firestore operations describe \
  "$EXPECTED_BACKUP_RESTORE_OPERATION" \
  --project="$ALLPLAYS_FIRESTORE_PROJECT_ID" \
  --format=json)"
jq -e \
  --arg backup "$EXPECTED_BACKUP_RESOURCE" \
  --arg uid "$EXPECTED_BACKUP_DRILL_UID" \
  '.done == true
    and (.error == null)
    and .metadata.operationState == "SUCCESSFUL"
    and .metadata.backup == $backup
    and .response.uid == $uid' \
  <<< "$restore_operation_json" >/dev/null

source_before_json="$(gcloud firestore databases describe \
  --project="$ALLPLAYS_FIRESTORE_PROJECT_ID" \
  --database='(default)' \
  --format=json)"
test "$(jq -r '.name' <<< "$source_before_json")" = "projects/$ALLPLAYS_FIRESTORE_PROJECT_ID/databases/(default)"
test "$(jq -r '.uid' <<< "$source_before_json")" = "$EXPECTED_SOURCE_DATABASE_UID"
test "$(jq -r '.deleteProtectionState' <<< "$source_before_json")" = 'DELETE_PROTECTION_ENABLED'

# A restored database inherits source delete protection. Disable it only after
# the exact isolated resource and exact backup origin have passed every guard.
# The Database ETag captured by the same guarded read is a precondition on this
# PATCH. A concurrent database change therefore fails instead of being erased.
set +x
allplays_access_token="$(gcloud auth print-access-token)"
protection_update_body="$(jq -cn \
  --arg name "$actual_resource" \
  --arg etag "$actual_etag" \
  '{name: $name, deleteProtectionState: "DELETE_PROTECTION_DISABLED", etag: $etag}')"
protection_update_response="$(curl --fail-with-body --silent --show-error \
  --request PATCH \
  --header "Authorization: Bearer $allplays_access_token" \
  --header 'Content-Type: application/json' \
  --data "$protection_update_body" \
  "https://firestore.googleapis.com/v1/$actual_resource?updateMask=deleteProtectionState")"
unset protection_update_body
protection_update_operation="$(jq -er '.name' <<< "$protection_update_response")"
test -n "$protection_update_operation"

# Poll only the operation returned by the conditional PATCH. Do not continue
# until it is complete and successful.
protection_update_complete=false
for attempt_number in {1..120}; do
  protection_update_operation_json="$(curl --fail-with-body --silent --show-error \
    --header "Authorization: Bearer $allplays_access_token" \
    "https://firestore.googleapis.com/v1/$protection_update_operation")"
  test "$(jq -r '.name' <<< "$protection_update_operation_json")" = "$protection_update_operation"
  test "$(jq -r '.error // empty' <<< "$protection_update_operation_json")" = ''
  if test "$(jq -r '.done // false' <<< "$protection_update_operation_json")" = true; then
    test "$(jq -r '.metadata.operationState // empty' <<< "$protection_update_operation_json")" = 'SUCCESSFUL'
    protection_update_complete=true
    break
  fi
  sleep 5
done
unset allplays_access_token
test "$protection_update_complete" = true

target_after_json="$(gcloud firestore databases describe \
  --project="$ALLPLAYS_FIRESTORE_PROJECT_ID" \
  --database="$EXPECTED_BACKUP_DRILL_DATABASE" \
  --format=json)"
test "$(jq -r '.name' <<< "$target_after_json")" = "$actual_resource"
test "$(jq -r '.uid' <<< "$target_after_json")" = "$EXPECTED_BACKUP_DRILL_UID"
test "$(jq -r '.deleteProtectionState' <<< "$target_after_json")" = 'DELETE_PROTECTION_DISABLED'
post_update_etag="$(jq -r '.etag' <<< "$target_after_json")"
test -n "$post_update_etag"

# Do not read the target again between this ETag capture and conditional delete.
gcloud firestore databases delete \
  --project="$ALLPLAYS_FIRESTORE_PROJECT_ID" \
  --database="$EXPECTED_BACKUP_DRILL_DATABASE" \
  --etag="$post_update_etag" \
  --quiet
```

Monitor the exact deletion operation to success, then require an exact describe
of that destination to return `NOT_FOUND`. Finally describe `(default)` and
require its delete protection still equals `DELETE_PROTECTION_ENABLED`, then
re-run the read-only posture verifier. If any guard fails, stop; do not broaden
the target or use a wildcard. Recheck the immutable source UID both before and
after cleanup. Never disable delete protection on `(default)`.

## Recovery drill evidence

### 2026-07-18 managed-backup restore drill

- Source: `projects/game-flow-c6311/databases/(default)`
- Source database UID: `523d6949-79b4-4368-b4cd-57c164d3451d`
- Backup: `projects/game-flow-c6311/locations/nam5/backups/d51ba64c-aa47-4372-a7fc-b78813ad6669`
- Backup snapshot: `2026-07-18T09:33:36.275104Z`
- Temporary destination: `backup-drill-20260718-a7c9e2`
- Restored database UID: `37bac8e6-78b4-4eb6-bd60-a8b622331d9b`
- Restore operation: `projects/game-flow-c6311/databases/backup-drill-20260718-a7c9e2/operations/mx0zIraoYL22TrR45si6NxAqNW1hbgQiChAaGg`
- Restore completed successfully: `2026-07-18T11:41:29.185967Z`
- Canonical five-document manifest SHA-256:
  `48945c35c303427aa31e0619436a4a2b9b82b4077aed9ffc54bd94eb973beb68`

The source samples all had `updateTime` at or before the backup snapshot. The
source and restored manifests matched byte-for-byte:

| Document path | Canonical `fields` SHA-256 |
| --- | --- |
| `accessCodes/[redacted]` | `2b06412c629472e0a7d51cbbc2b11513b648f577e708c4a08de323296b9bbf0f` |
| `teams/0JSOplS6f99GIYNS8Sk7` | `c7eaf6e36f772f6a8598b8c4d5f18e256b5a8fdbc6a91c08441f06ddcedba0bc` |
| `teams/0JSOplS6f99GIYNS8Sk7/games/U9EZjzu4jJnLzJuzNfPY` | `9bbc433c6ec88acd6e6adb090766fe01b58551ce908e8700591846b81ea587f6` |
| `users/1dfqx9IzBaVlYBg8ll54xF3Igbw2` | `ba75189f5add3c711ebcc3951ff51a842a0a7d37c7c8f29de36ccf4acc71c1e7` |
| `users/2NLQcX7wodVueeSTnsAPGRqBQ7E3` | `b050fd2ce25b43cbb0bfb096181742e750e84f094030db80f7596a0835a4b3ee` |

The contextual live-source and restored counts also matched: `users=40`,
`teams=50`, `accessCodes=88`, and the sampled nested games collection `=1`.
The manifest, rather than those post-snapshot live counts, is the deterministic
content proof.

The restored target inherited delete protection. Cleanup first proved its exact
name, UID, backup origin, and completed state while independently confirming the
source UID and source delete protection. It then disabled protection only on the
isolated target, recaptured that target's rotating ETag, and conditionally
deleted it with that ETag. Deletion operation
`projects/game-flow-c6311/databases/backup-drill-20260718-a7c9e2/operations/A8r-_YAQBtLt0Y8IDBoHEHfyiPAQBtLtzsAICwodGg`
reported delete time `2026-07-18T11:45:39.962576Z`. The destination then
returned `NOT_FOUND`; `(default)` retained UID
`523d6949-79b4-4368-b4cd-57c164d3451d`, delete protection, and PITR. No traffic
was moved, no source data was changed, and no raw document values were retained.

### 2026-07-18 PITR clone drill

- Source: `projects/game-flow-c6311/databases/(default)`
- Snapshot: `2026-07-18T02:40:00Z`
- Temporary destination: `restore-drill-20260718a`
- Clone operation:
  `projects/game-flow-c6311/databases/restore-drill-20260718a/operations/-HVvaGoOJpVFQ07xUd7VExAqNW1hbgQiDBAaGg`
- Clone completed: `2026-07-18T03:17:05.747809Z`
- Validation result: all sampled source and clone counts matched.

| Collection path | Source | Clone |
| --- | ---: | ---: |
| `users` | 40 | 40 |
| `teams` | 50 | 50 |
| `accessCodes` | 88 | 88 |
| `teams/0JSOplS6f99GIYNS8Sk7/games` | 1 | 1 |
| `teams/0JSOplS6f99GIYNS8Sk7/statTrackerConfigs` | 2 | 2 |

The isolated clone was deleted at `2026-07-18T03:22:45.217550Z` by operation
`projects/game-flow-c6311/databases/restore-drill-20260718a/operations/Z96ZsBAG0uvlsQgLGgcQAoe96qAQBtLr0IkIDAodGg`.
After cleanup, the temporary database returned `NOT_FOUND`; the source still
reported PITR and delete protection enabled. No production traffic was moved
and the source database was not changed by the drill.

This PITR evidence proves only the clone path and count sample performed on that
date. It does not claim field-checksum validation for the PITR clone; the
separate managed-backup evidence above provides the deterministic field-hash
restore proof.

## Incident recovery

1. Stop the writer that caused corruption before restoring anything.
2. Record the incident window and choose a PITR minute immediately before it.
3. Clone or restore into a new database and validate data there.
4. Do not redirect production clients until owners approve the validated data
   and a rollback plan exists.
5. Preserve the affected source database until the incident is closed.

PITR and backups incur Google Cloud storage and restore charges. Do not disable
them to address a transient billing alert; investigate usage and retention.
