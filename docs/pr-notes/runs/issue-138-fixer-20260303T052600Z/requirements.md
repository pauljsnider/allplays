# Requirements Role Output

## Problem Statement
Editing an existing practice must preserve the exact intended local start/end wall-clock time when the user opens and saves the form without changing datetime values.

## User Segments Impacted
- Coaches editing existing practices in schedule.
- Parents and players consuming schedule and RSVPs derived from stored practice time.
- Team admins responsible for schedule reliability.

## Acceptance Criteria
1. Practice edit prefill sets `practiceStart` using local `datetime-local` formatting, not UTC text.
2. Practice edit prefill sets `practiceEnd` using the same local formatting path when an end exists.
3. Saving a practice without datetime edits preserves original local wall-clock time semantics.
4. Regression coverage fails if `startEditPractice` reintroduces direct `toISOString().slice(0, 16)` assignment for practice fields.

## Non-Goals
- Refactor schedule architecture.
- Change Firestore timestamp storage format.
- Modify game edit behavior beyond preserving existing behavior.

## Edge Cases
- Practice with no explicit end time still uses default duration logic.
- Date values passed as Firestore Timestamp, Date, or ISO-compatible values.

## Open Questions
- None blocking for this targeted fix.
