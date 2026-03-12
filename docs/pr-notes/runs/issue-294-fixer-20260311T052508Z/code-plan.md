Thinking level: medium
Reason: shared helper update plus HTML wiring, but limited to one bug path.

Plan:
1. Add failing unit coverage for aggregated event `childIds` RSVP scope.
2. Update the shared resolver to treat `childIds` arrays on an event as allowed RSVP scope.
3. Wire `calendar.html` buttons and submit handler to pass child context from the clicked event.
4. Run focused RSVP tests, then the full unit suite if the focused run is clean.
5. Commit fix and tests together referencing issue #294.
