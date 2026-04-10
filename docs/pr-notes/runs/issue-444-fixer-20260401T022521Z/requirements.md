Objective: prove a saved Game Day lineup can be reloaded from persisted `gamePlan` data without losing visible assignments.

Current state
- Save payload coverage exists only at helper level.
- Reload coverage exists only for pure `lineups` parsing.
- There is no automated regression proving a coach-visible lineup survives save and reload in the same flow.

Proposed state
- Add one regression that saves a multi-period lineup, reloads the persisted `gamePlan`, and verifies the same formation and assignments are restored.
- Include visible-period behavior so the first rendered Game Day view shows the restored lineup immediately.

Constraints
- Keep the patch narrow.
- Reuse existing Vitest unit coverage patterns.
- Do not introduce unrelated UI or data-model changes.

Risk surface
- Core pregame workflow for coaches.
- Blast radius is limited to Game Day period selection and lineup persistence helpers.

Recommendation
- Cover the round-trip in unit tests using the existing lineup publish and interop modules.
- Fix the visible-period mismatch for 4-period formations during Game Day reload.
