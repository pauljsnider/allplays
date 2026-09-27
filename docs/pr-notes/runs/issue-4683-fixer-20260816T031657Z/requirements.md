# Requirements

## Problem Statement

Organization Schedule is creation-only. Full-access administrators need one trusted surface to review and cancel published shared matchups without navigating individual team schedules.

## Acceptance Criteria

1. Load upcoming games for each accessible team in the anchor team's organization grouping through bounded date queries.
2. Render only exact reciprocal shared-game pairs whose two teams and records are present in the authorized organization load.
3. Deduplicate by `sharedScheduleId`, select the canonical source deterministically, and sort earliest first.
4. Show home team, away team, local date and time, location, scheduled or cancelled status, and links to both schedules.
5. Allow cancellation only with full access to both teams and only while the pair is not fully cancelled.
6. Confirm before cancelling, reuse the existing two-team cancellation flow, verify both records cancelled, refresh, and suppress duplicate rows.
7. Treat reciprocal-sync, notification, and refresh failures as specific retryable errors. Never replace a failed complete load with authoritative emptiness.
8. Refresh after single creation, CSV import, draft publication, and cancellation.

## Non-Goals

- Editing, rescheduling, scoring, or repairing malformed records.
- Historical browsing, pagination, schema changes, or a new notification system.
- Broadening Firestore access or organization membership rules.

## Edge Cases

- Source records may omit `sharedScheduleSourceTeamId`; mirrors and draft records populate it.
- Duplicate reads, reused shared IDs, missing counterparts, one-way links, outside teams, invalid dates, and self-links must be rejected.
- A partial cancellation must remain actionable and must not be shown as success.
- A notification failure after verified cancellation must be reported as partial completion, not another cancellation opportunity.

## Open Questions Resolved

- Horizon: start of the local day through 365 days.
- Access: full access is required for both participating teams.
- Partial pair state: show a retryable incomplete-cancellation state rather than hiding the pair.
