# QA Notes

## Acceptance Criteria
- Opening the postgame summary editor enables Save Summary when no save is in progress.
- Closing the editor enables Save Summary for the next open.
- Clicking Save disables Save Summary during the async save.
- Save failure re-enables Save Summary.

## Validation
Run the targeted unit test:

```bash
npm run test:unit -- tests/unit/postgame-summary-editor.test.js
```

If time permits, run the CI unit suite:

```bash
npm run test:unit:ci
```
