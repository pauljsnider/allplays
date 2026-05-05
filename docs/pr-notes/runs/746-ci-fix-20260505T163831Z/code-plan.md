# Code Plan

## Implementation plan
1. In `buildModuleSource()`, add a replacement for the `team-entitlements.js` import.
2. Map the imported entitlement symbols to `deps.teamEntitlements`.
3. Add a minimal `teamEntitlements` mock in `bootReplayPage()`.
4. Run the targeted replay init test and full unit test command.

## Acceptance criteria
- No production files changed.
- `tests/unit/live-game-replay-init.test.js` no longer leaves the `team-entitlements` import in generated module source.
- Replay init tests pass locally.
- Full unit suite passes locally.

## Risks and rollback
The test remains brittle because it rewrites page source with string replacements. Rollback is a single-file revert if needed.
