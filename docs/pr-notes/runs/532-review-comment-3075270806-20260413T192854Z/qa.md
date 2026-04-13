## Risk Assessment
- **High:** Reload can put the wrong player on the field when `rotationActual` resolves `sub.in` by display name instead of stable player ID.
- **High:** Renaming a player after a substitution can orphan the saved sub on reload if only the old name is persisted.
- **Medium:** Mixed data is likely in production, with some subs saved as legacy name-only entries and newer subs saved with IDs.
- **Medium:** Ambiguous legacy duplicate-name entries cannot be safely disambiguated from name alone, so the fix must fail safe rather than silently pick the wrong player.

## Regression Targets
1. `buildOnFieldMap()` prefers persisted player ID for `sub.in` when available.
2. Duplicate display names do not cause the wrong player to appear after reload.
3. Player rename after sub save still resolves the same roster player after reload.
4. Legacy name-only substitution records still hydrate for unique-name rosters.
5. Mixed legacy and new substitution records in the same game and period render consistently.
6. Ambiguous or stale legacy records do not crash and do not silently remap to the wrong player.

## Test Matrix
| Scenario | Data shape | Method | Expected |
|---|---|---|---|
| Planned lineup only | plan only | automated | Returns planned IDs unchanged |
| New sub record with stable `inPlayerId` | new format | automated | On-field map uses persisted ID, not name lookup |
| Duplicate names, sub in second `Alex` | new format | automated | Correct `Alex` ID remains on field after reload |
| Player renamed after sub save | new format with rename | automated | Same player ID resolves after reload |
| Legacy unique-name sub | name-only legacy | automated | Existing legacy behavior still works |
| Mixed old and new subs in same period | hybrid | automated | New ID-backed subs win, legacy unique-name entries still hydrate |

## Manual Checks
1. In `test-game-day.html`, verify duplicate-name and renamed-player regressions pass.
2. In `game-day.html`, save a sub, refresh, and confirm the on-field player remains correct for duplicate-name and renamed-player fixtures.
3. Open a fixture with legacy name-only `rotationActual` entries and unique names, then reload and confirm prior games still render correctly.
4. Verify no regressions in normal substitution flow, live event log text, and position rendering.

## Exit Criteria
- Automated coverage exists for duplicate-name, renamed-player, and legacy-fallback cases in `test-game-day.html`.
- Reloaded `game-day.html` preserves the substituted player by stable ID whenever an ID is available.
- Legacy unique-name substitution records remain compatible.
- No regressions appear in standard substitution rendering or planned-lineup fallback.
