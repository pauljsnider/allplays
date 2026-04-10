# QA Role Summary

## Regression Focus
- Weekly `interval > 1` with `byDays` spanning multiple weekdays.
- Mid-week series start alignment.

## Added Coverage
- Biweekly Monday+Wednesday series starting Wednesday validates skip/include behavior across week boundaries.

## Manual Validation Targets
- Baseline: Monday biweekly remains `03-02, 03-16, 03-30, 04-13`.
- Edge: Wednesday start with Monday+Wednesday excludes `03-09`, includes `03-16` and `03-18`.
