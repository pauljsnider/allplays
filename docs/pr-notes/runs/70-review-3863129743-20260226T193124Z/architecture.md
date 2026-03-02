# Architecture Role (allplays-architecture-expert)

## Objective
Apply the smallest safe patch to the invite redemption module that restores control equivalence for team admin access and coach team membership.

## Current vs Proposed Architecture
- Current flow (`createInviteProcessor`):
  1. Validate code
  2. Load team/user
  3. Mutate local `adminEmails` only
  4. Overwrite `coachOf` with single team
  5. Mark code as used
- Proposed flow:
  1. Validate code
  2. Load team/user
  3. Persist `adminEmails` via `updateTeam` only when invited email not present
  4. Merge `coachOf` (set union) and append `coach` role without dropping existing roles
  5. Mark code as used

## Controls Equivalence/Improvement
- Improved: team admin authorization materialized in source of truth (`teams/{teamId}.adminEmails`).
- Improved: coach access blast radius reduced by eliminating destructive overwrite of `coachOf`.
- Preserved: single-use invite control (`markAccessCodeAsUsed`) remains required and unchanged.

## Blast Radius
- Files: `js/accept-invite-flow.js`, `accept-invite.html`, unit tests.
- No Firestore rules changes, no schema migration, no backend service changes.

## Rollback Plan
Revert this patch commit on PR branch to restore prior behavior if unexpected regressions appear.
