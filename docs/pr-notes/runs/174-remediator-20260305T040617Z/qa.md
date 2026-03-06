# QA role (fallback inline)

Manual validation plan:
1. Trigger stat updates, then immediately run Reset within 500ms.
   - Verify no delayed writes recreate `aggregatedStats` or non-zero game score after reset.
2. Trigger stat updates, then immediately run Cancel within 500ms.
   - Verify no delayed writes repopulate game docs before redirect.
3. Start game with existing data and choose "Cancel" on resume prompt (start over).
   - Verify pending writes are canceled and state remains clean.
4. After Reset, reload tracker and start timer with no new data.
   - Verify resume prompt does not appear due to stale `liveHasData`.

Repo has no automated runner for this page; execute targeted static checks only.
