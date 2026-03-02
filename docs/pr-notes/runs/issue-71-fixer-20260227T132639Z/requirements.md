# Requirements Role (allplays-requirements-expert equivalent)

## Objective
Ensure admin invite codes in `accept-invite` are single-use to prevent repeated unauthorized coach access.

## Current State
- Logged-in user redeeming `admin_invite` via `accept-invite.html?code=...` gains `coachOf` access.
- Code remains reusable because no consumption write is performed.

## Proposed State
- First successful admin invite redemption marks code used.
- Subsequent attempts fail validation with `Code already used`.

## User and UX Requirements
- Preserve existing success UX and redirect behavior.
- Preserve current error display path for invalid/used codes.
- No extra confirmation prompts; keep one-click redemption flow.

## Risk Surface and Blast Radius
- Risk today: leaked invite links can grant repeated team coach access (authorization escalation).
- Blast radius after fix: limited to single successful redemption per code, matching one-time semantics.

## Assumptions
- Admin invite code semantics are intended to be one-time use, same as parent invite semantics.
- Existing `validateAccessCode` + `markAccessCodeAsUsed` model is canonical.

## Acceptance Criteria
- Admin invite redemption performs code consumption write.
- Repeat redemption of same code is blocked by existing validation.
- Regression test covers this invariant.
