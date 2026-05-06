# Code Plan

- In `js/roster-profile-fields.js`, compute `hasNumberColumn` from mapped CSV headers.
- Keep parsing number values from mapped number columns.
- Change payload construction from always including `number` to conditionally including it only when `hasNumberColumn` is true.
- Add unit coverage in `tests/unit/roster-csv-import.test.js` for omitted Number header preserving existing jersey numbers.
