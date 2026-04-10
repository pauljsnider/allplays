Objective: Add automated coverage for the coach workflow where tournament/bracket games remain excluded from season record after save, reload, and subsequent edit.

Current state:
- `edit-schedule.html` exposes `seasonLabel`, `competitionType`, and `countsTowardSeasonRecord`.
- `team.html` calculates season record from saved games.
- Automated coverage only validates helper behavior in isolation, not the schedule-editor workflow.

Proposed state:
- Add regression tests that exercise create/edit/reload behavior through shared season-record metadata helpers.
- Keep the existing UX and payload contract unchanged.

Primary risks:
- Silent regression if the unchecked checkbox defaults back to `true`.
- Drift between create and edit code paths if metadata handling stays duplicated.

Assumptions:
- The repo’s current automation standard is Vitest-based source and helper testing, not full browser E2E.
- A shared helper extraction is acceptable as the smallest change that improves regression protection without refactoring the page.

Recommendation:
- Extract the season-record metadata read/write rules into a tiny helper module and cover two workflows:
- New completed tournament game saved with `countsTowardSeasonRecord=false` stays excluded after reload.
- Existing completed tournament game edited and re-saved keeps exclusion while same-season league games still count.
