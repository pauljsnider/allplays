# Architecture Role Notes

## Current state
`finalizeParentInviteSignup` can redeem invite first, then on downstream failure attempt rollback and still delete auth user even when rollback cannot fully restore invite state.

## Proposed state
Use a guard: delete auth user only when invite redemption never happened or invite rollback succeeded.

## Risk and blast radius
- Scope: parent invite onboarding only.
- Primary risk addressed: consumed invite with deleted auth account (manual repair path).
- Tradeoff: in rollback failure branch, orphan auth account may remain; this is preferred because user can retry/profile-repair with existing identity instead of hard lockout.

## Controls
- Preserve fail-closed behavior for invalid/failed invite code validation.
- Preserve rollback ordering (invite rollback before auth rollback).
