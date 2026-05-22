# Architecture

- Keep the filter localized in `js/live-tracker-resume.js`, where state.log is reconstructed from liveEvents.
- Do not change live event broadcasting or aggregate stat reconstruction, since reversal events may still be needed to preserve effective totals when aggregate docs are absent.
- Use both negative value and explicit description prefix to avoid excluding legitimate future stat events accidentally.

## Risks And Rollback

- Risk: filtering only by description could hide valid events; mitigated by also requiring negative value.
- Rollback: remove the local `isReversalStatBroadcast` guard.
