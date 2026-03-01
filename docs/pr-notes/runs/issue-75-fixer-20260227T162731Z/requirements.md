# Requirements role output

## Objective
Fix access revocation so removing an admin in Edit Team also revokes management permissions that currently persist via stale `users/{uid}.coachOf`.

## Current vs proposed
- Current: Edit Team removal updates only `teams/{teamId}.adminEmails`; access checks still grant full access when `coachOf` contains the team.
- Proposed: treat team management authorization as owner/admin-email/global-admin only; `coachOf` remains non-authoritative metadata so stale entries cannot preserve access.

## Constraints
- Keep patch minimal and focused on issue #75.
- Preserve normal invited-admin access through `adminEmails`.
- Add regression tests in existing unit framework.

## Success criteria
- A user removed from `adminEmails` no longer has full team management access even if `coachOf` still includes that team.
- Firestore rule path for team management writes no longer relies on `coachOf`.
- Unit tests cover stale-`coachOf` denial behavior.
