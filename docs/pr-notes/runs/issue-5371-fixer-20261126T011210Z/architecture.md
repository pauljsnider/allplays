# Architecture analysis — issue #5371

## Existing trust flow

The current implementation uses `requested -> preparing -> prepared -> executing -> completed|failed|partial`. Page load is read-only; preparation and execution are transactionally claimed; expiry is rechecked; displayed pending arguments are fingerprinted; and ambiguous persistence remains in `preparing` or `executing` so it cannot be replayed.

User envelopes are read only under the signed-in UID. Team payloads are re-read through current manager authorization and matched by user, tool, digest, and team. The existing private-AI pending-action claim is the final single-execution boundary.

## Root cause and narrow design

The original missing bridge between MCP review requests and the browser/Capacitor private-AI mutation registry was added in commit `363d2542`. The remaining defect is presentation drift: `completed` and `failed` responses leave the page's loaded status stale, while `executing` does not explain that the action is still running or its outcome is uncertain.

Keep the service state machine unchanged. Reconcile a resolved terminal result in page state, reload only partial results because their remaining preview can change, and map non-actionable statuses to explicit fail-closed guidance. Unknown states remain non-actionable.

## Risks

- Never turn `executing` back into `prepared` after ambiguity.
- Never infer completion from a missing response or from partial work.
- Never trust team arguments from the user envelope.
- Do not add a second MCP execution API or change OAuth/transport behavior.
