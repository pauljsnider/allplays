# Code Role Plan (manual fallback)

## Minimal patch plan
1. Add helper module `js/live-tracker-opponent-stats.js` with:
   - `buildOpponentStatDefaults(columns)`
   - `hydrateOpponentStats(data, columns)`
2. Add unit tests `tests/unit/live-tracker-opponent-stats.test.js` reproducing missing-fouls regression.
3. Update `js/live-tracker.js` resume mapping to use `hydrateOpponentStats`.
4. Run Vitest targeted and full unit suite.
5. Commit only issue-relevant files.

## Conflict resolution
- Requirements/QA want explicit foul preservation.
- Architecture wants low-blast-radius and testability.
- Chosen approach is tiny helper extraction + single call-site change, balancing safety and regression coverage.
