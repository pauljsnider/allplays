# QA Role Notes

## Regression focus
- Preserve valid TZID conversions.
- Preserve numeric-offset parsing and UTC (`Z`) parsing.
- Ensure malformed `TZID` cannot silently become local time.

## Test updates
Add unit coverage for `DTSTART;TZID=/:...` expecting:
- 0 parsed events
- warning call for malformed TZID

## Guardrails
Keep existing timezone tests passing (`ics-timezone-parse.test.js`).
