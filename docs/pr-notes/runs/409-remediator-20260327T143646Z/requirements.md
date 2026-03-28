Objective: Fix PR #409 replay accuracy regression where seeking past a reset can render pre-reset events after the reset.

Current state:
- `seekReplay` rebuilds replay state by passing every event up to `targetMs` into one `processNewEvents` call.
- `processNewEvents` computes the reset boundary once, before iterating the batch.

Required behavior:
- Replay application must honor reset boundaries inside the same seek window.
- After a reset event is encountered, older pre-reset events must not survive or be rendered in the rebuilt replay state.

Assumptions:
- Replay events remain sorted by `gameClockMs`, not by creation timestamp.
- The intended fix scope is limited to replay rebuild behavior, not general live subscription flow.
