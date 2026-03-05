# Requirements Role Summary

## Objective
Prevent final score corruption when a resumed tracker session has only a partial in-memory scoring log.

## User-visible risk
- Coaches/parents can lose already-recorded points at game completion.
- Blast radius includes final game score, recap, and downstream reporting integrity.

## Decision
- Reconcile final score from log only when log completeness is explicitly guaranteed for the full tracked session.

## Acceptance Criteria
- Resume/reload flows with existing persisted data do not allow log-derived overwrite of final score.
- Fresh sessions with complete in-memory log still allow reconciliation safety checks.
- Clearing log marks log as incomplete for reconciliation.
