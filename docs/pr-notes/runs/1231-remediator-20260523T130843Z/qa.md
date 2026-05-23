# QA Plan

## Automated Checks
- Run the focused unit test file: `npx vitest run tests/unit/team-fees-admin.test.js`.
- Verify existing CSV escaping tests still pass.
- Verify new formula injection examples are neutralized for `=`, `+`, `-`, `@`, and pipe-delimited formula markers.

## Manual Checks
- Export a payment summary with admin notes or references containing formula-like text.
- Open the CSV in a spreadsheet and confirm dangerous values render as text, not formulas.
