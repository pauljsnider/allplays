# Requirements

## Problem Statement

The Team Media dispatcher treats its 50-record query safety limit as the total invocation throughput limit. Sustained arrivals above 200 batches per hour therefore create an indefinitely growing backlog and increasingly late notifications.

## User Segments Impacted

- Coaches, parents, admins, and fans need timely, non-duplicated album alerts.
- Operators need a deterministic summary that distinguishes a drained queue from budget-deferred work.

## Acceptance Criteria

1. One invocation drains at least 120 due pending batches when budgets permit.
2. Every query is ordered by `dueAt` ascending and capped at 50 records.
3. The worker stops for `drained`, `maxPages`, or `maxRuntimeMs` and reports processed count.
4. Page/runtime deferrals resume next run without duplicating terminal batches.
5. Failed released batches are not retried through the same forward cursor.
6. Existing audience revalidation, claims, dedup keys, payloads, skips, and release behavior remain unchanged.

## Non-Goals

- Scheduler cadence, upload limits, album grouping, UI, recipient resolution, inbox retention, FCM chunking, or preference redesign.

## Edge Cases

- Empty and partial pages, exact 50-record boundaries, equal due timestamps, concurrent claim loss, missing albums, released failures, and runtime expiry between records.

## Open Questions Resolved

- Use the repository's existing bounded reminder-drain defaults: 50 records, 10 pages, and 8 minutes.
- Return and log the drain summary.
- Use Firestore's ordered snapshot cursor, including its implicit document-name tie-breaker.
