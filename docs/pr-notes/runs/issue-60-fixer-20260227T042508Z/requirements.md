# Requirements Role Synthesis

## Objective
Ensure accepted admin invites persist team admin access immediately so invitees can manage team resources.

## Current vs Proposed
- Current: `accept-invite.html` shows admin-success messaging but does not persist `team.adminEmails` update.
- Proposed: admin invite acceptance must atomically persist admin membership (`teams/{teamId}.adminEmails`) and mark invite used before showing success.

## Risk Surface / Blast Radius
- Affected area: invite acceptance flow for `admin_invite` only.
- Blast radius: team-management authorization and dashboard team visibility.
- Data risk: duplicate/malformed emails in `adminEmails`; potential overwrite of existing `coachOf`/roles arrays if profile updates are non-merge-safe.

## Assumptions
- Admin entitlement source of truth is `team.adminEmails`.
- Access code redemption should be idempotent and mark invite as used.
- Existing parent invite flow remains unchanged.

## Recommendation
Implement a dedicated DB-layer admin redemption helper used by `accept-invite.html`, so acceptance writes both team membership and user role metadata with merge-safe array operations.

## Success Criteria
- After admin invite acceptance, invited email appears in `teams/{teamId}.adminEmails` (case-normalized).
- Invitee can load dashboard team list and edit-team/roster/schedule pages for that team.
- Regression coverage includes persistence + idempotency behavior.
