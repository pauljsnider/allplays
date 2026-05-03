# Code Plan

1. Update `getRosterFieldDefinitions()` in `js/roster-field-privacy.js` to select the first candidate where `Array.isArray(entry) && entry.length > 0`.
2. Keep normalization, sensitive field handling, and visibility filtering unchanged.
3. Extend `tests/unit/roster-field-privacy.test.js` with a regression test covering empty primary schema plus populated fallback schema.
