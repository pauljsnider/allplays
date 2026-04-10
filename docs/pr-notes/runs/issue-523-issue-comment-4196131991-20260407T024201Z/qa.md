## Coverage Matrix
| Scope | State / branch covered | Evidence |
| --- | --- | --- |
| Schedule card render | Cancelled future game | `tests/unit/team-schedule-card-render.test.js` `fails closed for cancelled future games` |
| Schedule card render | Upcoming scheduled game | `tests/unit/team-schedule-card-render.test.js` `renders upcoming scheduled games with live-view CTAs` |
| Schedule card render | Live game | `tests/unit/team-schedule-card-render.test.js` `renders live games with live badge, score block, and live URL` |
| Schedule card render | Completed report vs replay branching | `tests/unit/team-schedule-card-render.test.js` `renders completed replay CTAs only when live playback exists` |
| Schedule card render | Completed tie | `tests/unit/team-schedule-card-render.test.js` `renders tied completed games with the tie badge` |
| Event normalization | DB event preserves CTA-driving fields | `tests/unit/team-schedule-events.test.js` `preserves CTA-driving db game fields and marks cancelled games explicitly` |
| Next-game selection | Cancelled games excluded | `tests/unit/team-schedule-events.test.js` `keeps non-cancelled future games eligible for next game selection` |

## Assertions
- Cancelled cards fail closed before any live or upcoming CTA renders.
- Upcoming scheduled cards retain their live/share CTA path.
- Live cards retain live badge, score block, and live link behavior.
- Completed cards retain report/share actions, with replay gated to replay-ready state.
- `getAllEvents()` preserves the fields the renderer depends on.
- `getNextGame()` excludes cancelled future games.

## Gaps
- No explicit `Not Tracked` branch test yet.
- No explicit practice-card coverage yet.
- No explicit win/loss badge split assertion yet.
- No list/calendar integration coverage yet.

## Validation
- Targeted regression run passed for the two Issue #523 test files.
- Full unit suite passed in the active worktree.
