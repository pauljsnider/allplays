# QA

## Test Strategy
- Unit coverage for schema normalization, import payload shaping, reset guards, and order persistence.
- Smoke coverage on `edit-config.html` with mocked auth/db, extending the existing platform-admin spec.
- Manual integration checks across `edit-schedule.html`, `track.html`, `track-statsheet.html`, `team.html`, and `player.html`.

## Highest-Risk Regressions
- Silent tracker fallback if a referenced config disappears or loses expected order.
- Cross-team authorization leakage during import.
- Downstream display drift when `config.columns` or `statDefinitions` order changes.
- Reset semantics expanding beyond schema-only behavior.

## Manual Test Matrix
- Apply preset and save.
- Import from another owned team and verify source stays unchanged.
- Edit an existing config and verify reload persistence.
- Verify schedule assignment still points at the selected config.
- Open tracker and statsheet flows to confirm column order and mapping stay correct.
- Verify leaderboard and player top-stat rendering still reflect the edited schema.
- Reset with no dependent games, then retry with referenced configs and confirm guard behavior.

## Suggested Low-Cost Automated Coverage
- Extend `tests/smoke/edit-config-platform-admin.spec.js` for preset, import, edit, and reset flows.
- Add unit coverage for shared preset helpers, serialization, and reset guards.
- Add at least one negative path for reset blocked/cancelled behavior.

## Exit Criteria
- Owner/admin completes preset, import, edit, and reset flows successfully.
- Non-manager access remains blocked.
- No downstream page falls back silently for active referenced configs.
- Unit and smoke coverage exist for the new schema lifecycle behavior.
- Reset semantics remain schema-only and are explicitly guarded.
