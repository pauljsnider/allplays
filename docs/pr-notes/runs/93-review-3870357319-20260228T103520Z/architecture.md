# Architecture Role Notes

## Decision
Apply mode-aware query option at call site in `live-game.js` instead of changing `db.js` defaults.

## Why
- Preserves existing API behavior and avoids cross-page regressions.
- Keeps control local to one consumer with clear business intent.
- Aligns with least-change principle for PR feedback remediation.

## Control Equivalence
- Data access remains read-only and team-scoped.
- No security model changes; only filtering behavior by UI mode.

## Rollback
Revert the single conditional argument in `live-game.js` if unintended historical impact appears.
