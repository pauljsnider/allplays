# Diamond Scorebook v2

This specification defines the fail-closed, server-authoritative baseball and
fastpitch scorebook that succeeds the existing passive stat tracker without
changing legacy games. It is bound to implementation base
`713cc18e645052e562a90a430c91b3855bf94940`.

The implementation is delivered from `codex/diamond-scorebook-v2` as one pull
request. Code may be deployed while the global policy remains disabled; rollout
is controlled independently for new, explicitly activated games.

The repository does not create or widen the production policy as part of the
merge. A missing policy is treated exactly like a disabled policy: new setup,
activation, and ordinary scoring are denied and the new setup/activation UI is
hidden. Once an `internal` or `pilot` policy explicitly admits a team, its
managers may prepare rules without claiming a game; game ownership still
requires a separate activation decision. Disabled-mode passivity must be
verified before the draft PR is made ready.

## Documents

- [Requirements](requirements.md)
- [Research and product decisions](research-and-decisions.md)
- [Canonical event and API contract](event-contract.md)
- [Stat and completeness catalog](stat-catalog.md)
- [Validation and rollout](validation.md)

## Non-negotiable invariants

1. Missing, malformed, or unreadable rollout policy disables activation and
   ordinary scoring; existing-game recovery paths remain available as described
   below.
2. Existing games and games containing legacy tracking data remain legacy.
3. A game has one permanent tracking engine. No client may write both engines.
4. Accepted commands append immutable events and advance one monotonic revision.
5. Corrections append compensating events; they never rewrite canonical history.
6. Every projection declares its source revision and is safe to rebuild.
7. Partial capture is labeled; omitted data is never converted into zero.
8. Voice and AI produce editable proposals only. A scorer explicitly confirms
   every official mutation.
9. Raw audio is not retained. Private notes and transcripts never enter public
   projections or telemetry.
10. Disabling new scoring never disables read, replay, manager-confirmed
    cancellation, correction, projection, or cleanup for games already owned by
    Diamond v2.

## Relationship to the passive tracker

This specification supersedes the scorekeeping limitations in
`spec/baseball-softball-support` only for newly activated Diamond v2 games. The
passive tracker remains the compatibility implementation for every existing
game, every shared-schedule mirror until a canonical shared ledger is designed,
and every game that does not pass the fail-closed activation gates.
