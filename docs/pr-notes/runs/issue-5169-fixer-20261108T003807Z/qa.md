# QA review

## Regression matrix

1. A valid membership ID delegates exactly once with the authenticated user ID and trimmed membership ID, returning the adapter result.
2. Empty, whitespace-only, and missing membership IDs reject with zero adapter calls.
3. An adapter rejection propagates as the same error after exactly one call.

These tests belong in `apps/app/src/lib/parentHouseholdService.test.ts` and fail before implementation because the service export and adapter binding are absent.

## Focused validation

```bash
npm --prefix apps/app exec -- vitest run src/lib/parentHouseholdService.test.ts --reporter=verbose
npm --prefix apps/app run typecheck
```
