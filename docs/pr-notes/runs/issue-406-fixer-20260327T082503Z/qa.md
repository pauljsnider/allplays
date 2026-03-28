Test focus:
- Prove recurring practice creation persists the expected series payload through `addPractice(...)`.
- Prove recurring practice edits persist via `updateEvent(...)` and preserve the existing `seriesId`.
- Reconfirm the page submit path is wired through the shared save helper instead of drifting back inline.

Regression risks:
- The extracted helper could change save semantics for one-time practices if the default path is not preserved.
- Edit mode could accidentally generate a new `seriesId` instead of preserving the existing series master identity.
- Static page wiring could regress even if the helper tests pass.

Planned validation:
- Add a focused Vitest suite for the new save helper that fails before the helper exists.
- Re-run the existing recurrence payload tests to confirm the helper composition remains intact.
- Run the focused unit test command for the new suite plus the existing practice payload suite.

Manual reasoning:
- The issue is specifically about payload persistence correctness, so helper-level save-path tests provide strong coverage for this targeted fix without needing a full browser runner in the repo.
