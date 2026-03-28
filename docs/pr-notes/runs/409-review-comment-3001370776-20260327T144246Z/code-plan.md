## Code Role Summary

- Implementation choice: extract sequential visibility filtering into `collectVisibleLiveEventsSequentially()` and reuse it inside `processNewEvents()`.
- Safety choice: remove the replay-only sequential wrapper and let the shared event processor handle replay seek batches directly after sequential filtering.
- Validation performed: source diff review plus direct `node` module assertion of the new helper behavior.
- Runtime gap: requested allplays orchestration skills and role subagent/session tooling were not installed in this environment, so these notes capture the equivalent role outputs manually.
