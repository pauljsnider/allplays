# Requirements Role Summary

## Objective
Restore test reliability for team chat unread badge behavior by aligning tests with implemented snapshot policy.

## Current vs Proposed
- Current: Tests pass an `initialSnapshotLoaded` parameter that the implementation does not consume.
- Proposed: Tests only assert user/team context gates and keep update behavior active on both initial and subsequent snapshots.

## Risks and Controls
- Risk: Policy ambiguity between "initial only" and "all snapshots".
- Control: Keep behavior explicit in function doc comment and test names covering both initial and subsequent snapshots.

## Acceptance Criteria
- `shouldUpdateChatLastRead` tests do not pass undeclared parameters.
- Tests explicitly validate updates on initial and subsequent snapshots.
- Missing user/team context still blocks updates.
