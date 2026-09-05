# Diamond Scorebook v2

This specification defines the fail-closed, server-authoritative baseball and
fastpitch scorebook that succeeds the existing passive stat tracker without
changing legacy games. It is bound to implementation base
`713cc18e645052e562a90a430c91b3855bf94940`.

The implementation is delivered from `codex/diamond-scorebook-v2` as one pull
request. Code may be deployed while the global policy remains disabled; rollout
is controlled independently for new, explicitly activated games.

## Documents

- [Requirements](requirements.md)
- [Canonical event and API contract](event-contract.md)
- [Stat and completeness catalog](stat-catalog.md)
- [Validation and rollout](validation.md)

## Non-negotiable invariants

1. Missing, malformed, or unreadable rollout policy disables activation and
   scoring.
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
10. Disabling new scoring never disables read, replay, correction, projection,
    or cleanup for games already owned by Diamond v2.
