# Architecture Role Summary

## Decision
Add a post-write verification read in `redeemAdminInviteAcceptance`:
1. Persist `coachOf`/`roles` on `/users/{uid}`.
2. Re-read profile and verify `coachOf` includes `teamId`.
3. Only then update `/teams/{teamId}.adminEmails`.

## Tradeoff
Adds one extra user-doc read to remove ambiguity at permission boundary and fail fast with a deterministic error.

## Blast Radius
Limited to admin-invite acceptance path. No schema changes.
