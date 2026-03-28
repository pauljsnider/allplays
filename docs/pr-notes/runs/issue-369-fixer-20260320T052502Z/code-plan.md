# Code Role (allplays-code-expert equivalent fallback)

Requested orchestration skill `allplays-orchestrator-playbook`, role skill `allplays-code-expert`, and `sessions_spawn` are unavailable in this runtime. This artifact captures equivalent implementation planning.

## Plan
1. Add failing tests for a new CSV import helper module and for `edit-schedule.html` wiring.
2. Implement `js/schedule-csv-import.js` as a pure parser/normalizer.
3. Add a dedicated CSV import tab and preview UI in `edit-schedule.html`.
4. Wire preview save to `addGame` / `addPractice`, plus optional chat notification and notification metadata updates.
5. Run `vitest` for the changed area and commit the result.

## Constraints
- Keep the change targeted. No unrelated schedule refactors.
- Preserve existing manual, ICS, and AI flows.
- Favor deterministic parsing over “best effort” magic.
