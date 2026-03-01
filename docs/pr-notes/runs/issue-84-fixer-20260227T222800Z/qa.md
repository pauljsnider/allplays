# QA Role Output

## Test Strategy
- Add unit test coverage for ICS parsing classification:
  - summary includes `Practice` => `isPractice === true`
  - summary includes `Training` => `isPractice === true`
  - typical game summary => `isPractice === false`

## Regression Guardrails
- Verify parser still returns existing fields (`dtstart`, `summary`, `uid`) for same fixture.
- Keep fixture minimal and deterministic.

## Manual Spot Check
- In `calendar.html` ingestion, `type` assignment remains `ev.isPractice ? 'practice' : 'game'`; parser now supplies expected flag.
