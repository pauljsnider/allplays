# Requirements analysis

## Root cause

Queue mode validates a proposed substitution only against the current lineup. It does not project already queued substitutions, so the UI can promise multiple swaps that cannot all be applied.

## Acceptance criteria

- A proposed queued swap is accepted only when the existing queue plus the proposal is valid against the projected lineup.
- Applying a queue validates the whole queue before recording history, changing the lineup, logging substitutions, broadcasting events, or persisting state.
- An invalid queue remains available for correction and produces a clear conflict message.
- Quick-swap behavior remains unchanged.

## User impact

Coaches and scorekeepers must be able to trust the displayed queue count. A failed queued operation must not leave playing time, the broadcast lineup, or subsequent statistics attached to a partially changed lineup.
