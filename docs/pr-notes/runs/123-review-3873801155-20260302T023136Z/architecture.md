# Architecture Role Summary

## Decision
Keep authorization centralized in `js/team-access.js` and add delegated coach evaluation there with explicit `team.id` validation.

## Control Equivalence
- Existing controls: owner + team admin email + platform admin checks.
- Added control: delegated coach check only when `team.id` is a non-empty string.
- Security posture: improved defensive behavior for undefined/malformed team objects.

## Tradeoffs
- Minimal code path change avoids duplicated authorization logic in page scripts.
- String-only `team.id` check is strict and predictable; malformed IDs fail closed.

## Rollback
Revert helper delta in `js/team-access.js`; no schema/config changes required.
