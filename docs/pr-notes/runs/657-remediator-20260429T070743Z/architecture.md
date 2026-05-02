# Architecture Decisions

- The payload builder already treats `startsAt` as a valid start timestamp source.
- Local conflict matching should use the same start timestamp precedence list as payload creation so planning and writing interpret source rows consistently.
- Minimal fix: include `sourceEvent.startsAt` in `isSameLocalEvent` source date parsing.
- Existing local event parsing remains unchanged unless a separate local schema requires more fields later.

## Risks And Rollback
- Risk is low: only expands matching for a previously accepted source field.
- Rollback is reverting the one-line parser change if it causes unexpected matching.
