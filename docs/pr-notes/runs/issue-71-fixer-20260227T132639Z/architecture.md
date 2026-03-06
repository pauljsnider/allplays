# Architecture Role (allplays-architecture-expert equivalent)

## Objective
Close one-time code enforcement gap in accept-invite admin path with minimal surface area.

## Root Cause
- `accept-invite.html` inline `processInvite` handles `admin_invite` without calling `markAccessCodeAsUsed`.
- `validateAccessCode` is read-only by design.

## Proposed Technical Change
- Extract invite processing logic into `js/accept-invite-flow.js` for unit testability.
- Wire `accept-invite.html` to call extracted `processInviteCode(...)` with injected DB methods.
- In admin branch, call `markAccessCodeAsUsed(validation.codeId, userId)` after successful profile update.

## Conflict Resolution
- Requirements prioritizes preserving UX.
- QA prioritizes regression testability and deterministic dependency injection.
- Code role prioritizes minimal patch footprint.
- Synthesis: isolate logic in a single helper module and keep HTML behavior/DOM/state handling unchanged.

## Control Equivalence
- Uses existing DB contract (`validateAccessCode` + `markAccessCodeAsUsed`) rather than introducing new persistence logic.
- No broad auth/rules changes; only consumes invite after successful redemption action.

## Rollback Plan
- Revert commit to restore prior behavior if unexpected issues arise.
