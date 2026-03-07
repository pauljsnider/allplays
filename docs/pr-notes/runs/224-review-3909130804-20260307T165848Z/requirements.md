# Requirements Role Summary

Thinking level: medium

## Objective
Fix the parent incentives PR so only linked parents can persist incentive data, penalties are never softened by the cap, and parents get a truthful UI state when incentive stats fail to load.

## Current State
- Incentive data lives under `/users/{uid}/...`, but writes are not constrained to a real parent-player link.
- Per-game caps clamp the final net total, which can offset penalties.
- Breakdown text is inserted into HTML without escaping.
- Incentive panel loads assume stat reads succeed.

## Proposed State
- Every incentive rule, cap, and paid-game record must carry `teamId` + `playerId`, and rules must validate that the signed-in user is linked to that exact player.
- The cap must limit positive earnings only, then penalties apply afterward.
- Breakdown strings must be escaped before insertion.
- Incentives panel must surface a clear error state on stat-load failure.

## Risk Surface
- Firestore rules: highest impact, because a bad rule can block legitimate parent access.
- Cap document shape: moderate, because call sites must provide `teamId`.
- UI error handling: low blast radius, incentives panel only.

## Acceptance Criteria
- An unrelated signed-in user cannot create/update/delete incentive docs for a player they are not linked to.
- A game with bonuses above the cap and penalties still applies the full penalty after capping the positive portion.
- Breakdown output cannot inject HTML.
- Failed aggregated-stat reads log an error and produce a user-visible failure state instead of stale or misleading earnings.
