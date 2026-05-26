# Architecture

## Architecture Decisions
- Keep the CSV column pipeline unchanged: column definitions still own value extraction and `escapeRegistrationCsvValue` still owns serialization safety.
- Change only the missing-value fallback at the CSV row assembly boundary from truthiness to nullish semantics.

## Risks And Rollback
- Risk is low and scoped to CSV export formatting.
- Rollback is a single-line reversion plus removal of the targeted regression test if needed.
