Objective: preserve the scorer-visible explanation when final score reconciliation overrides the manually entered score during live tracker finish.

Current state:
- `saveAndComplete()` builds the finish plan before adding the reconciliation note to `state.log`.
- Persisted `events` and recap email content are generated from the pre-note log.

Proposed state:
- The reconciliation explanation is part of the effective finish log before persistence and email navigation are built.
- The UI still shows the reconciliation note after commit so the scorer sees the same explanation locally.

Risk surface and blast radius:
- Path writes completed game state, event history, aggregated stats, and recap navigation.
- Regression risk is limited to finish/save flows for live tracking; no broader auth or team-management behavior changes.

Assumptions:
- The reconciliation explanation should be durable audit context, not just transient UI text.
- Existing score reconciliation rules remain the source of truth.

Acceptance criteria:
- When trusted score-log reconciliation changes the final score, the explanation is included in persisted event writes.
- When recap email is enabled, the generated email body receives the same augmented log.
- Existing redirect and non-reconciliation flows remain unchanged.
