# Requirements

## Objective
Prevent live tracker events from being lost if the browser reloads, closes, or crashes while the pending queue is being replayed after a reconnect.

## Acceptance Criteria
- Pending live events remain in localStorage until each event is successfully replayed.
- A replay failure leaves the failed event, and any later unsent events, in the persisted queue for the next retry/load.
- Successful replay removes only the event that actually finished sending.
- Existing live tracker resume and start-over behaviors keep passing.

## User/Risk Framing
- Coaches and scorekeepers need reconnect recovery to be trustworthy during a live game.
- Parents and viewers should not lose scoring or lineup updates because a device refreshed mid-retry.
- Blast radius is limited to the live tracker retry path and localStorage queue handling.

## Non-Goals
- No backend protocol changes.
- No queue schema change.
- No broad retry-system refactor beyond fixing replay persistence semantics.
