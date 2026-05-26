# Code Plan

## Implementation Plan
- In `js/registration-review.js`, change `column.value(row, registration) || ''` to `column.value(row, registration) ?? ''`.
- In `tests/unit/registration-review.test.js`, add regression coverage proving `0` and `false` survive custom selected-column export.
