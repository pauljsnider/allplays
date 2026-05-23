# QA Plan

## Automated coverage
- `escapeCsvValue()` neutralizes leading `=`, `+`, `-`, `@`, and `|`.
- Leading whitespace before dangerous markers is neutralized.
- Dangerous values containing commas and quotes are both neutralized and CSV-escaped correctly.
- Safe values and empty/null/undefined values remain unchanged.
- Serialization-level test proves dangerous row fields are neutralized in final CSV output.

## Command gate
Run the affected unit tests for `tests/unit/team-fees-admin.test.js`.

## Manual check
Export a payment summary containing dangerous recipient/note/reference values and confirm spreadsheet apps treat them as text, while normal commas, quotes, multiline notes, amounts, dates, and statuses remain aligned.
