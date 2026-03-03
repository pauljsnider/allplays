# QA Role Output

## Risk Matrix
- High: timezone drift on schedule save alters player/parent expectations.
- Medium: regression via future edits to schedule prefill code path.
- Low: unrelated schedule operations.

## Automated Tests To Add/Update
- Add unit guard test validating practice edit prefill uses `formatIsoForInput` and not direct UTC `toISOString().slice(0, 16)` assignment.

## Manual Test Plan
1. In non-UTC timezone (e.g., America/Chicago), create practice at 6:30 PM.
2. Open edit modal/form, do not change times, save.
3. Reload schedule and confirm practice remains at 6:30 PM.

## Negative Tests
- Ensure no reintroduction of direct UTC prefill for `practiceStart`/`practiceEnd`.

## Release Gates
- New regression unit test passes.
- Existing targeted schedule-related tests pass.

## Post-Deploy Checks
- Spot-check at least one non-UTC team practice edit-save cycle in production-like environment.
