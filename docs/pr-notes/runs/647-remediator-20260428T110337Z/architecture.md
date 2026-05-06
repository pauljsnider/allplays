# Architecture

Subagent spawn was unavailable in this runtime, so this role analysis was completed inline.

## Architecture Decisions
- Keep the existing game clip action handler and `shareOrCopy` utility contract.
- Add local `try/catch` around the direct clipboard path so permission/security/browser rejections are contained.
- Fall through to the existing `shareOrCopy` fallback after direct copy failure, preserving one centralized share/copy result handling path.

## Risks And Rollback
- Risk: fallback may open the native share sheet on platforms that support it. This is acceptable because the direct copy path already failed and the existing utility prefers native share before clipboard fallback.
- Rollback: revert the single `js/live-game.js` handler change.
