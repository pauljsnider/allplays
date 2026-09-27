# Architecture

## Current-State Read

`dispatchDueTeamMediaNotificationBatches` performs one pending/due `limit(50)` query with no ordering, then exits. Claims, audience revalidation, terminal writes, release-on-failure, and `team-media:${batch.id}` deduplication are already correct.

## Proposed Design

- Reuse `drainDueReminderPages` without changing its shared contract.
- Fix one due cutoff per invocation.
- Load ordered pages using `status == pending`, `dueAt <= cutoff`, `orderBy('dueAt', 'asc')`, `limit(50)`, and `startAfter(lastSnapshot)`.
- Keep the forward cursor after a failed batch is released so it retries only next invocation.
- Aggregate sent, skipped, released, and unclaimed dispositions into an operational summary.

## Files And Modules Touched

- `functions/index.js`
- `functions/test/team-media-notification-batches.test.js`
- `functions/test/send-category-notification-test-helpers.cjs`
- `tests/unit/media-award-notification-contract.test.js`
- `functions/package.json`

## Data/State Impacts

No schema or index changes. Existing `pending -> sending -> sent|skipped|pending` transitions remain intact.

## Security/Permissions Impacts

No client or rules changes. Current server-side audience revalidation and transactional claims remain the authorization and concurrency boundaries.

## Failure Modes And Mitigations

- Page/runtime caps bound blast radius.
- Forward cursors prevent same-run poison-batch loops.
- Terminal statuses and stable dedup keys prevent duplicates across runs.
- Lost claims are examined but not processed.
