# QA Plan

Subagent spawning with role-specific agents was unavailable in this runtime, so this note captures the inline QA analysis.

## Validation
- Static inspection: confirm `createdCounterpartRef` is assigned only after a new opponent-team game is created.
- Static inspection: confirm final source update failure deletes the created counterpart and rethrows the original error.
- Manual scenario: simulate Firestore failure on final source update after counterpart creation and verify opponent game is removed while the caller still receives `Shared matchup was not fully published`.
- Regression scenario: update an existing shared game and confirm a failed source update does not delete an existing counterpart.

## Automated Tests
No automated test runner exists for this repo per AGENTS.md/CLAUDE.md.
