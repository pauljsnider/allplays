# Requirements — Issue #4888

## Outcome

- Parents receive at most one push and one inbox reminder per fee recipient per scheduler invocation.
- Expired claims recover automatically without changing eligibility, preferences, timing, copy, routes, or send-marker semantics.
- Leased-recipient backlogs stay within predictable Firestore paging, worker-concurrency, and runtime bounds.

## Root cause

`sendFeeUnpaidDueReminders` pages upcoming recipients, but leased recovery still performs one unordered, unlimited collection-group `get()`. The full leased population bypasses page/runtime controls, and the existing one-shot path filter is not a reusable per-page deduplication boundary.

## Required semantics

1. Page leased discovery by `reminderDeliveryClaimExpiresAtMillis > 0` with deterministic ordering, an explicit limit, and document-snapshot `startAfter` cursors.
2. Use one invocation-scoped set keyed by full document path. Register paths before concurrent worker dispatch so overlap and failures cannot schedule a second attempt in the same invocation.
3. Preserve active-lease blocking, expired no-effects release/reclaim, recently-overdue recovery grace, effects-started finalization, claim ownership, ambiguous-commit reconciliation, and first-retryable-error propagation.
4. Report pages, stop reasons, unique examined recipients, sends, and failures for leased, upcoming, and aggregate work.

## Edge cases and coverage

- More than two leased pages, including an eligible expired lease on page three.
- A future-due expired lease returned by both leased and upcoming queries.
- Equal expiry values, full-path identity across collection-group parents, active leases, and terminally ineligible stale leases.
- Exactly one inbox and push effect for each overlapping recipient.
- Existing bounded-drain tests remain the page/runtime-cap behavioral proof; scheduler source and integration tests prove both populations use that primitive.
