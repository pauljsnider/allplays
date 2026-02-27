# Requirements Role Summary

## Objective
Ensure admin invite redemption grants admin access exactly once and persists team admin membership reliably.

## Current State
`processInviteCode` appends user email to `team.adminEmails` in memory but does not persist to Firestore.

## Proposed State
On successful `admin_invite` redemption, persist `adminEmails` via `updateTeam(teamId, { adminEmails })` when the redeemer email is newly added.

## Risk Surface and Blast Radius
- Scope: admin invite redemption path only.
- Blast radius: low, isolated to `accept-invite.html` + invite flow module.
- Data risk: incorrect persistence can block intended admin access.

## Assumptions
- `getUserProfile(userId)` returns normalized or normalizable email.
- `updateTeam` merges partial team fields without destructive overwrite.

## Success Criteria
- New admin redeemer is persisted to `teams/{teamId}.adminEmails`.
- Duplicate email (case-insensitive) does not create additional writes.
- Existing one-time code consumption behavior remains intact.
