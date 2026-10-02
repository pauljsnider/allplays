# Requirements analysis

> The requested `allplays-requirements-expert` skill was unavailable, so the role applied the specified UX, coach, parent, and sports-manager perspectives directly.

## Root cause

`sendFeeUnpaidDueReminders` issued one unbounded upcoming-recipient collection-group read, then created one promise per discovered document. Recipient growth could therefore increase Firestore reads and simultaneous notification work without a fixed ceiling.

## Required outcome

- Page only the upcoming `feeRecipients` query with the existing status and 72-hour due-date filters.
- Add deterministic `dueDate` ordering, an explicit page limit, and document-snapshot `startAfter` progression.
- Process every reached page through the existing fixed-concurrency worker helper.
- Emit upcoming examined, sent, failed, page, and stopping-reason counts.
- Preserve eligibility, configured thresholds, Auth/team/player access, fee preferences, claim/payment rechecks, retries, and one-send-per-threshold markers.

## Scope boundaries

- Do not paginate or reorder the leased/expired-lease recovery query.
- Do not redesign cross-query deduplication.
- Do not change thresholds, schedule, notification copy, recipient schema, or delivery routes.

## Acceptance evidence

A fixture larger than the configured page size must deliver a recipient from page two while proving every upcoming query requests at most one configured page. Existing claim, payment-state, preference, retry, lease, and marker tests remain the behavioral guardrail.
