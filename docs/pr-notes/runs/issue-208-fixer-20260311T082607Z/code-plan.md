# Code role

- Add utility helpers to resolve an ICS event's canonical tracking id and to test whether an event is already tracked.
- Update recurring-calendar consumers to use the helper instead of `trackedUids.includes(event.uid)`.
- Persist occurrence ids when a calendar event is converted into a tracked DB game.
- Use occurrence ids in shared/parent calendar event models where ids drive downstream actions.
- Add a narrow regression test file for recurring tracking identity behavior.
