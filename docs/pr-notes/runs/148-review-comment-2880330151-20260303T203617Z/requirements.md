# Requirements Role Output

## Problem Statement
ICS-imported cancelled events can be missed when the summary marker casing varies (for example `[Canceled]`), causing incorrect scheduled-state rendering in calendar views.

## User Segments Impacted
- Coaches: need fast, accurate cancelled-game visibility before practices/games.
- Parents: need trustworthy schedule state to avoid travel mistakes.
- Team admins/managers: need reliable imported calendar normalization without manual cleanup.

## Acceptance Criteria
1. ICS mapping marks an event cancelled when `STATUS:CANCELLED` is present, independent of summary text.
2. ICS mapping marks an event cancelled when summary starts with cancellation marker in any casing, supporting both `[CANCELED]` and `[CANCELLED]` spellings.
3. Non-cancelled events without cancelled status/marker remain `scheduled`.
4. Existing UI logic that relies on normalized `status: 'cancelled'` behavior remains unchanged.

## Non-Goals
- Broad refactor of cancellation logic across unrelated pages.
- Changing displayed labels/text for cancelled events.
- Modifying Firestore event status semantics.

## Edge Cases
- Leading whitespace before cancellation marker.
- Mixed-case marker text.
- Missing or non-string summary.

## Open Questions
- Should cancellation marker matching also support marker text appearing mid-summary (not prefix)? Current behavior intentionally treats it as prefix semantics.
