# Code Role Summary

## Patch Scope
1. Update recurrence `until` boundary normalization in `js/utils.js`.
2. Add timezone regression case in `tests/unit/recurrence-until-inclusive.test.js`.
3. Run focused unit tests.

## Risk Mitigation
- Keep logic isolated to `until` boundary construction.
- Preserve existing local-midnight behavior.
- Add explicit test for non-UTC locale path.
