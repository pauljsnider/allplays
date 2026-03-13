# QA Role (allplays-qa-expert)

## Test Strategy
1. Extend unit coverage for `buildGlobalCalendarIcsEvent` to verify cancelled TeamSnap-style titles map to `status: 'cancelled'` and display a cleaned title.
2. Extend the calendar page source regression test to require explicit cancelled presentation in compact mode.
3. Run the targeted Vitest files, then the full unit suite if the focused run passes.

## Regression Guardrails
- Keep tests deterministic and isolated from DOM/browser runtime by asserting helper output and page source.
- Preserve existing cancelled detection for both ICS `STATUS` and summary prefix variants.

## Manual Smoke (optional)
- Subscribe a team to an ICS feed with a cancelled event.
- Verify `calendar.html` detailed, compact, and day-detail views all show the event as cancelled rather than active.
