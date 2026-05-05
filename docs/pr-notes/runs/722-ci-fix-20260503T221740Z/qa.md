# QA Notes

## Failing check
- `preview-smoke [preview-smoke]`

## Diagnosis
The two failing Bulk AI smoke tests timed out waiting for `#roster-image-preview` to become visible. The issue is test drift, not product behavior: the mocked `db.js` module was missing named exports now imported by `edit-roster.html`, so the page module aborted before the image change handler was attached.

## Validation command
Run with a static server serving the repo at `http://127.0.0.1:4173`:

```bash
npx playwright test -c playwright.smoke.config.js tests/smoke/edit-roster-bulk-ai-reset.spec.js --reporter=line
```

Expected result: both tests pass.

## Edge cases covered
- Upload preview becomes visible after file selection.
- Cancel clears file input, preview visibility, and preview image `src`.
- Fresh text-only run after cancel does not include stale image data.
