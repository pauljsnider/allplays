# Requirements Role Summary

## Objective
Ensure admin invite acceptance succeeds for newly invited users under current Firestore authorization constraints.

## Current State
`redeemAdminInviteAcceptance` writes `teams/{teamId}.adminEmails` before the invited user has any qualifying role, which can fail rules checks for non-admin invitees.

## Proposed State
Write invited user access (`users/{uid}.coachOf += teamId`, `roles += coach`) first, then persist `team.adminEmails` and mark access code used.

## Risk Surface
- Multi-tenant team access path (`teams`, `users`, `accessCodes`).
- Failure mode: denied team write blocks invite redemption.

## Acceptance Criteria
1. Invite acceptance no longer attempts restricted team write before user role grant.
2. Unit tests verify merged profile behavior and call ordering.
3. Existing invite flows continue to mark access codes used when `codeId` is provided.

## Assumptions
- Firestore rules continue treating `coachOf` as team admin-equivalent access (`isCoachForTeam`).
