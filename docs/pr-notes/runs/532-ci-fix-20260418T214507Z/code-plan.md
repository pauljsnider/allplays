# Code Plan

## Acceptance Criteria
- The failing game-day live substitution tests pass in CI.
- Assertions verify the stable ID fields now persisted on substitution records.
- No production code changes are required for this CI fix.

## Root Cause
- `js/game-day-live-substitutions.js` persists additive `outId`/`inId` and alias ID fields.
- `tests/unit/game-day-live-substitutions.test.js` still deep-equaled the old name-only objects, so Vitest failed on extra keys.

## Implementation Plan
1. Update the two failing assertions to inspect the first saved substitution entry.
2. Assert the existing display fields plus the new stable ID fields with `toMatchObject`.
3. Run the targeted Vitest file.

## Risks And Rollback
- Low risk because only test expectations change.
- Roll back by reverting the note files and the unit test if needed.
