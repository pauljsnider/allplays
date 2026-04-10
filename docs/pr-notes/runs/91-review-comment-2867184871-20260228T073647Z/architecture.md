# Architecture Role Notes

## Current state
Realtime snapshot callback updates `chatLastRead` whenever user/team context exists.

## Proposed state
Extend policy helper input with `isPageVisible` and `isWindowFocused`; guard last-read updates through helper to keep logic centralized and testable.

## Blast radius
Low. Change is scoped to Team Chat read receipt behavior and unit tests for helper logic.

## Controls
- Keep decision logic in `js/team-chat-last-read.js`.
- Avoid ad hoc checks at multiple call sites.
