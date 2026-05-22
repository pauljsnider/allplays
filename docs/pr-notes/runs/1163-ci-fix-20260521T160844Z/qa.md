# QA Notes

## QA Plan
- Re-run `node scripts/check-critical-cache-bust.mjs` with pull request environment variables matching CI.
- Confirm the script reports `Critical cache-bust guard passed.`

## Regression Risk
- No functional JavaScript behavior changes are expected because only an import query parameter is bumped.
- Browser impact is intentional cache invalidation for the changed `js/db.js` dependency.
