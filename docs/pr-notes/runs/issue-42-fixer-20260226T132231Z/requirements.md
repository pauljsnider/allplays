# Requirements Role Notes

## Objective
Ensure admin invite acceptance grants actual team admin access, not just success messaging.

## Current State
- Admin invite acceptance flow reports success.
- Profile fields (`coachOf`/`roles`) may be set.
- Team-level authorization commonly checks `team.adminEmails`.
- Invited admin can be blocked from team management/chat moderation.

## Proposed State
- Accepting an admin invite persists team-level admin linkage (`team.adminEmails`) and updates profile linkage.
- Acceptance is idempotent and safe for retries.

## Risk Surface / Blast Radius
- High user-facing impact if unchanged: delegated team management is broken.
- Low code blast radius if fix is scoped to invite acceptance and targeted persistence helper.

## Assumptions
- Admin invite codes are single-use and include `teamId`.
- User email is available at acceptance time.
- Existing checks against `team.adminEmails` remain canonical for team-admin authorization.

## Recommendation
Implement a shared admin-invite acceptance helper used by both `accept-invite.html` and signup auth paths so all invite acceptance routes persist `team.adminEmails` and user coach role data.

## Success Criteria
- Invited admin appears authorized in access checks relying on `team.adminEmails`.
- Regression tests verify team admin persistence and profile merge behavior.
