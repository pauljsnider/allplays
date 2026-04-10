# Issue #440 Requirements Synthesis

## Objective
Add automated coverage for the live tracker "Save & Complete" finalization path so regressions in final score persistence, completion state, recap composition, and duplicate-submit protection are caught before shipping.

## Current State
- Helper-level score reconciliation is covered.
- Helper-level single-flight locking is covered.
- Email finish wiring is only covered by source inspection.
- The composed finish workflow in `saveAndComplete()` is not executed in tests.

## Proposed State
- A test executes the finish workflow with mocked Firestore and navigation dependencies.
- Coverage proves the persisted game update uses reconciled totals from the score log when the log is trusted.
- Coverage proves completion status logic runs before navigation side effects.
- Coverage proves a second finish click is ignored while the first submission is in flight.

## Risk Surface
- Incorrect final score saved to the game document.
- `liveStatus` left live instead of completed.
- Summary email composed from stale manual scores.
- Duplicate events, duplicate stats writes, or repeated redirect/mailto on double-click.

## Assumptions
- Existing unit tests under `tests/unit` are the correct automation surface for this repo despite older docs mentioning manual testing only.
- A small extraction seam is acceptable if behavior is unchanged and the user-facing workflow remains owned by `saveAndComplete()`.

## Recommendation
Extract the finish execution path into a testable helper and cover it with focused unit tests. This preserves the existing UI flow while adding evidence for the exact high-risk path called out in the issue.
