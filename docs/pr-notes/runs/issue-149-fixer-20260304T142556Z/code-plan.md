# Code Role Synthesis (Fallback)

## Note on orchestration tooling
Requested skills (`allplays-orchestrator-playbook`, `allplays-code-expert`) and `sessions_spawn` are not available in this runtime. This artifact captures equivalent implementation plan.

## Plan
1. Add failing regression test in `tests/unit/recurrence-expand.test.js` for old weekly series still producing future occurrences.
2. Patch `expandRecurrence` in `js/utils.js` to initialize `current` near `windowStart` while preserving interval alignment.
3. Run targeted Vitest files for recurrence.
4. Stage changes and commit with issue reference `#149`.

## Non-goals
- No edits to `edit-schedule.html` rendering.
- No recurrence schema changes.
