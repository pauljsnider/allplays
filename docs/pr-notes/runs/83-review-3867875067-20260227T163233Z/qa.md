# QA Role Notes

## Regression Focus
- Prevent documentation from reintroducing incorrect assumptions about `coachOf` authorization.

## Checks
1. Run targeted unit tests for team access helper.
2. Confirm JSDoc wording matches current assertions (`coachOf` does not grant full access).

## Pass Criteria
- Unit test suite for `team-access` passes.
- File-level diff shows documentation-only modification.
