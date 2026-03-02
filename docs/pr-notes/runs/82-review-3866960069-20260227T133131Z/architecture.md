# Architecture Role Summary

## Decision
Inject `updateTeam` as a dependency into `processInviteCode` and invoke it only when `adminEmails` changes.

## Why
- Maintains existing testable dependency-injection pattern.
- Avoids direct DB imports in flow module.
- Keeps write amplification low by guarding duplicate emails case-insensitively.

## Control Equivalence
- No weakening of invite validation or access-code consumption controls.
- Adds missing persistence control needed for admin authorization lookup (`adminEmails` array).

## Rollback
Revert the three touched files (`accept-invite-flow.js`, `accept-invite.html`, invite flow unit tests) if regression appears.
