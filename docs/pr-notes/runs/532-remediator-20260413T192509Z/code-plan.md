# Code Plan

## Root Cause
- The merged on-field map stopped using stable roster IDs and instead replayed substitutions through display-name lookup.

## Minimal Patch Shape
1. Add a helper that resolves substitution participants by stored player ID first, then by legacy name.
2. Update `buildOnFieldMap(period)` to use the helper when applying `rotationActual` substitutions.
3. Persist `outId` and `inId` when saving a new substitution entry.
4. Update `test-game-day.html` to mirror the production logic and cover duplicate-name replay.

## Validation
- Load the HTML test page and confirm Suite 5 passes.
- Review the diff to ensure only substitution replay and test coverage changed.
