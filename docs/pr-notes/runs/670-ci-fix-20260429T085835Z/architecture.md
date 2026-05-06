# Architecture Notes

## Acceptance Criteria
- Live tracker retry queue tests must evaluate `js/live-tracker.js` with all imported live-stream helpers bound in the harness.
- Import replacement logic must not consume multiple adjacent imports and leave later helpers undefined.
- Production code behavior remains unchanged.

## Architecture Decision
The failure is in the unit harness import-rewrite boundary, not the runtime architecture. `js/live-tracker.js` imports video timestamp helpers from `live-stream-utils.js`; the harness already stubs those helpers, but its broad `[\s\S]*?` named-import regex can span across imports and replace the wrong section, leaving `hasConfiguredLiveStream` undefined during pending finalization replay.

## Minimal Fix
Constrain live tracker harness named-import rewrites to the current import block with `[^}]*` instead of `[\s\S]*?`. This keeps each dependency rewrite isolated and prevents unrelated imports from being swallowed.

## Risks And Rollback
Risk is limited to tests. Rollback is restoring the previous regex, but that reopens the import swallowing failure mode.
