# Requirements Role Notes

## Objective
Preserve navigation warnings until final completion write succeeds so users do not lose game-end data on slow or flaky networks.

## Current vs Proposed
- Current: `saveAndComplete()` sets `isFinishing = true` before Firestore `batch.commit()`, disabling unsaved-change warnings during an in-flight write.
- Proposed: set finishing state only after the completion write and live-broadcast shutdown succeed.

## Risk Surface / Blast Radius
- Surface: only live tracker finalization flow (`js/live-tracker.js`).
- Blast radius: warning prompts (`beforeunload`, browser back) during save-and-complete.

## Assumptions
- Users can navigate away before `batch.commit()` resolves.
- `state.clock > 0` remains the intended unsaved-activity heuristic for these trackers.

## Recommendation
Move finishing-state transition after successful persistence to preserve warning guardrails during write latency.

## Success Criteria
- During Save & Complete, warnings still appear until commit succeeds.
- After successful commit, redirect proceeds without warning loops.
