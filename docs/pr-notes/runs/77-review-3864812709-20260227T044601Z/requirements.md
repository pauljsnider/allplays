# Requirements Role Summary

## Objective
Ensure admin invite redemption preserves authorization controls and cannot succeed without consuming a valid invite code.

## Current State
- Admin invite redemption persisted team admin membership and coach role.
- Persistence path treated `codeId` as optional, allowing a non-consumptive success path if `codeId` was absent.

## Proposed State
- Fail closed when `validation.codeId` is missing.
- Require `codeId` during persistence and mark it used in the same atomic operation as team/user updates.

## Risk Surface
- Primary risk: partial or non-consumptive invite redemption that widens unauthorized re-use blast radius.
- Blast radius reduced from team-level repeated invite redemption to single-use enforced redemption.

## Acceptance Criteria
- Admin invite redemption throws when `codeId` is absent.
- Persistence rejects non-admin codes, mismatched team mapping, and already-used access codes.
- Team membership + role + invite use marking occur atomically.
