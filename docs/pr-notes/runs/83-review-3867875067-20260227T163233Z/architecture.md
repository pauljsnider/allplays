# Architecture Role Notes

## Decision
Use a minimal doc correction in `js/team-access.js` without touching authorization code paths.

## Why
- Security behavior was already corrected in code and rules.
- Remaining inconsistency is interface documentation drift.

## Controls / Auditability
- Authorization source of truth remains: ownerId, adminEmails, and platform admin flag.
- No control-surface expansion.

## Rollback
- Single-line comment reversion if needed (`git revert` commit containing doc change).
