# Architecture Role

- Objective: address silent notification failure without widening the transactional scope of lineup publishing.
- Current state: `persistGamePlanWithButton()` persists `gamePlan`, then executes optional `afterPersist()`. Failures in `afterPersist()` are caught as partial failures and logged.
- Proposed state: retain the existing sequencing and failure isolation, but convert the partial failure path into an operator-visible alert with actionable text.
- Why this path:
  - avoids coupling lineup persistence to chat delivery
  - avoids rollback complexity for an already-persisted Firestore update
  - keeps failure semantics explicit: data saved, notification missed
- Blast radius comparison:
  - Current: silent operational miss, low user awareness
  - New: same persistence path, added UI feedback only
- Control equivalence:
  - no new writes
  - no new permissions
  - no change to published payload shape or recipient targeting
- Acceptance criteria:
  - `updateGame()` still succeeds independently of `postChatMessage()`
  - notification errors continue to log for debugging
  - coaches receive a manual-remediation alert after a partial failure
