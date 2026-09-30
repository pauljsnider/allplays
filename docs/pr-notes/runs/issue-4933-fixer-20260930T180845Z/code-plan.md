# Code plan

## Minimal patch

1. Add `drainOrderedPages` to `functions/pre-event-reminder-dispatcher-core.cjs` without modifying current production callers.
2. Validate `loadPage`, `processPage`, `pageSize`, and `maxPages`.
3. Load pages with the exact explicit limit, process in order, aggregate explicit count deltas, and advance only with the returned `nextCursor`.
4. Stop as drained for an empty/short/cursorless page and as page-capped after the configured number of full continuing pages.
5. Export the helper and add focused unit coverage in the existing dispatcher-core test file.

## Pitfalls

- Do not infer counts from arbitrary existing reminder result objects.
- Do not swallow exceptions or add runtime enforcement.
- Do not replace the existing helper or alter fee-reminder wiring.
