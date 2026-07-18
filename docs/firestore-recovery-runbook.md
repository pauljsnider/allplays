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

Authenticate `gcloud` as a principal with Firestore backup-viewer access, then
run:

```bash
npm run ops:verify-firestore-recovery
```

The command prints only recovery metadata. It does not read application
documents or mutate the database.

## Point-in-time recovery drill

Never restore over `(default)`. A drill creates a separate, temporary database
from a whole-minute PITR timestamp:

```bash
gcloud firestore databases clone \
  --project=game-flow-c6311 \
  --source-database='projects/game-flow-c6311/databases/(default)' \
  --snapshot-time='YYYY-MM-DDTHH:MM:00Z' \
  --destination-database='restore-drill-YYYYMMDD'
```

Wait until `sourceInfo.progress` is `COMPLETED`, then compare collection and
document counts for representative top-level and nested collections. Validate
at minimum `users`, `teams`, `accessCodes`, and a team subcollection. Record the
snapshot time, operation name, counts, and result before deleting the isolated
drill database.

Delete only the exact drill database after validation:

```bash
gcloud firestore databases delete \
  --project=game-flow-c6311 \
  --database='restore-drill-YYYYMMDD' \
  --quiet
```

## Managed-backup restore drill

After the first scheduled backup reaches `READY`, exercise the independent
managed-backup path at least quarterly:

```bash
gcloud firestore backups list --project=game-flow-c6311
gcloud firestore databases restore \
  --project=game-flow-c6311 \
  --source-backup='projects/game-flow-c6311/locations/nam5/backups/BACKUP_ID' \
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
