Test strategy:
- Add unit coverage for the shared helper:
  - hides a recurring session when its master practice has the instance date in `exDates`
  - keeps unmatched draft sessions visible
  - hides directly linked cancelled one-off practices
- Add a light wiring assertion so `parent-dashboard.html` is confirmed to use the shared helper in both:
  - unmatched schedule-session fallback
  - packet/attendance row builder

Regression guardrails:
- Do not change recurrence expansion behavior itself.
- Do not hide sessions that lack schedule linkage unless they explicitly map to a cancelled practice.
- Keep existing recurring session matching logic intact for active occurrences.

Manual validation focus after tests:
- Cancel a recurring occurrence with an existing practice plan/home packet, refresh parent dashboard, confirm the occurrence is absent from both upcoming schedule and packet card.
- Confirm a future unmatched draft practice session still appears.
