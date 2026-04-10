Smallest change:
1. Update the focused RSVP unit tests to pass `getAllScheduleEvents` instead of the removed `allScheduleEvents` constructor field.
2. Add one regression proving the controller reads the latest hydrated schedule array.
3. Add one wiring assertion proving `window.submitGameRsvpFromButton` is exported after controller initialization.
4. Run the focused Vitest file with the locally available binary and push only if green.
