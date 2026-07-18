# Firestore recovery runbook

The production `game-flow-c6311/(default)` database has three independent
recovery controls:

- seven-day point-in-time recovery (PITR);
- database delete protection;
- a daily managed backup retained for 14 days.

The scheduled `firestore-recovery-health` workflow checks those settings every
day and fails if the newest ready backup is more than 36 hours old. A newly
created schedule gets one 36-hour grace window to produce its first backup.

## Verify the recovery posture

Authenticate `gcloud` as a principal with a project-level custom role containing
exactly these read-only Firestore permissions:

- `datastore.databases.getMetadata` for the database posture;
- `datastore.backupSchedules.list` for the managed-backup schedule; and
- `datastore.backups.list` for backup lineage and freshness.

No single read-only Firestore predefined role contains all three permissions.
If a custom role is unavailable, grant the principal all of
`roles/datastore.viewer`, `roles/datastore.backupSchedulesViewer`, and
`roles/datastore.backupsViewer`. That predefined-role combination is broader
than the custom role because `roles/datastore.viewer` can also read application
documents.

Then run:

```bash
export ALLPLAYS_FIRESTORE_PROJECT_ID='YOUR_PROJECT_ID'
npm run ops:verify-firestore-recovery -- --project="$ALLPLAYS_FIRESTORE_PROJECT_ID"
```

The command prints only recovery metadata. It does not read application
documents or mutate the database.

## Point-in-time recovery drill

Never restore over `(default)`. A drill creates a separate, temporary database
from a whole-minute PITR timestamp:

```bash
export ALLPLAYS_FIRESTORE_PROJECT_ID='YOUR_PROJECT_ID'
gcloud firestore databases clone \
  --project="$ALLPLAYS_FIRESTORE_PROJECT_ID" \
  --source-database="projects/$ALLPLAYS_FIRESTORE_PROJECT_ID/databases/(default)" \
  --snapshot-time='YYYY-MM-DDTHH:MM:00Z' \
  --destination-database='restore-drill-YYYYMMDD'
```

Use the operation name returned by the clone command to monitor the clone:

```bash
gcloud firestore operations describe 'OPERATION_NAME' \
  --project="$ALLPLAYS_FIRESTORE_PROJECT_ID" \
  --format='yaml(done,error,metadata.operationState,metadata.progressPercentage)'
```

Wait until `done` is true and `metadata.operationState` is `SUCCESSFUL`, then
compare collection and document counts for representative top-level and nested
collections. Use `metadata.progressPercentage` only to monitor an operation
still in progress. If the operation reports an error or a failed or cancelled
state, stop the drill and investigate instead of validating the clone. Validate
at minimum `users`, `teams`, `accessCodes`, and a team subcollection. Record the
snapshot time, operation name, counts, and result before deleting the isolated
drill database.

Delete only the exact drill database after validation:

```bash
gcloud firestore databases delete \
  --project="$ALLPLAYS_FIRESTORE_PROJECT_ID" \
  --database='restore-drill-YYYYMMDD' \
  --quiet
```

## Managed-backup restore drill

After the first scheduled backup reaches `READY`, exercise the independent
managed-backup path at least quarterly:

```bash
gcloud firestore backups list --project="$ALLPLAYS_FIRESTORE_PROJECT_ID"
gcloud firestore databases restore \
  --project="$ALLPLAYS_FIRESTORE_PROJECT_ID" \
  --source-backup="projects/$ALLPLAYS_FIRESTORE_PROJECT_ID/locations/nam5/backups/BACKUP_ID" \
  --destination-database='backup-drill-YYYYMMDD'
```

Validate the same representative counts, record the evidence, and delete only
the temporary restored database. A managed backup restore always creates a new
database; production traffic remains on `(default)` throughout the drill.

## Recovery drill evidence

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

The managed-backup schedule was still within its documented initial 36-hour
window when this PITR drill ran. Run the independent managed-backup restore
drill after the first scheduled backup reaches `READY`.

## Incident recovery

1. Stop the writer that caused corruption before restoring anything.
2. Record the incident window and choose a PITR minute immediately before it.
3. Clone or restore into a new database and validate data there.
4. Do not redirect production clients until owners approve the validated data
   and a rollback plan exists.
5. Preserve the affected source database until the incident is closed.

PITR and backups incur Google Cloud storage/restore charges. Do not disable them
to address a transient billing alert; investigate usage and retention first.
