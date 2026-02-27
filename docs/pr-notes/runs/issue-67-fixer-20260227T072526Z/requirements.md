# Requirements Role Analysis (manual fallback)

Requested orchestration skills (`allplays-orchestrator-playbook` and role skills) are not installed in this runtime, so this artifact captures equivalent analysis.

## Objective
Prevent opponent foul totals from being reset during live-tracker resume and persisted as zero on finish/save.

## User-visible requirement
- If a game already has `game.opponentStats[*].fouls`, resuming tracked data must preserve those values in tracker state.
- Finishing/saving after resume must persist the same foul totals unless explicitly edited.

## Acceptance criteria
- Resume hydration copies configured columns and `fouls` from persisted `game.opponentStats`.
- Existing behavior for missing `fouls` remains safe (`0` fallback).
- Regression test proves hydrated opponent stats include non-zero fouls when present.

## Risk and blast radius
- Scope limited to opponent resume mapping in `live-tracker.js`.
- No schema changes, no Firestore rule changes, no UI changes.
- Primary risk is unintended side effects in opponent stat initialization.
