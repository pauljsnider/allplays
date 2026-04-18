## Acceptance Criteria
1. Help-center integrity coverage passes on Windows, macOS, and Linux without path-resolution failures.
2. `help.html` continues to expose a visible, working entry point to `help-page-reference.html`.
3. `help-page-reference.html` lists only shipped `.html` pages, so users are not sent to removed or nonexistent screens.
4. Smoke coverage confirms a user can move from Help Center to the page-reference view and back without broken navigation.
5. File-resolution checks remain strict enough to catch missing shipped pages before release, regardless of contributor OS.
6. Coach/admin help discovery stays intact, so game-day and schedule workflows remain easy to find under time pressure.

## User Risks
- Coaches/admins can miss broken help links if Windows contributors cannot run the integrity test.
- Parents can lose trust in help references when shared links silently fail.
- Cross-platform fragility weakens release confidence and encourages skipping useful guardrails.

## Scope Boundaries
- In scope: cross-platform reliability of `tests/unit/help-page-reference-integrity.test.js` and preservation of existing help-center navigation.
- In scope: continued validation that referenced HTML pages exist in the repo.
- Out of scope: Help Center redesign, help copy changes, or broader framework/path cleanup elsewhere.

## Recommended Test Expectations
- Derive repo-root paths with a Windows-safe approach.
- Keep assertions that `help.html` links to `help-page-reference.html`.
- Keep sentinel expectations for `edit-schedule.html`, `live-game.html`, and `help-page-reference.html`.
- Keep existence checks limited to shipped `.html` files for fast deterministic CI coverage.
