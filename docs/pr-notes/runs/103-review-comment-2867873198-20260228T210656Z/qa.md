# QA Role Notes

## Regression Guardrails
- Add explicit tests for malformed offsets that previously passed regex parsing:
  - `DTSTART:20260310T180000-9999`
  - `DTSTART:20260310T180000+2599`
- Assert parser drops event and emits `Invalid ICS numeric UTC offset:` warning.

## Impacted Workflow
- ICS import path for event datetime parsing in `parseICS` -> `parseICSDate`.

## Validation Scope
- Run `tests/unit/ics-timezone-parse.test.js` to confirm:
  - valid offset/UTC/TZID behavior still works
  - invalid numeric offset inputs are rejected
