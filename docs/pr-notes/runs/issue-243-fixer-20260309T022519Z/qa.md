Test strategy:
- Add a unit test covering a weekly RRULE master plus a moved occurrence defined by `RECURRENCE-ID`.
- Assert the original generated slot is suppressed, the override is kept, and each resulting occurrence has a stable ID.
- Re-run existing ICS recurrence and calendar fetch suites to guard baseline parsing and fetch behavior.

Key regressions to watch:
- Weekly `COUNT` expansion
- `EXDATE` exclusions
- TZID wall-clock preservation across DST
- Non-recurring ICS events continuing to parse unchanged

Manual spot-check if needed:
- Load a feed with a moved recurring practice and confirm only the moved date appears for that week.
