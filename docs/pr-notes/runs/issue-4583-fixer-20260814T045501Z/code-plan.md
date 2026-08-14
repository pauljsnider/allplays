# Code Plan

## Patch Plan

1. Alias the existing bounded drain defaults with named Team Media page/runtime limits.
2. Extract the existing single-batch body without changing claims, audience, payload, dedup, skip, or release semantics.
3. Add an ordered page loader and aggregate dispositions into a stop summary.
4. Extend the stateful Firestore test harness for ordered, limited, cursor-based batch queries.
5. Add focused regressions and register the suite in the notification entrypoint.

## Code Changes Applied

None during role analysis. The main lane owns all edits.

## Validation Run

- `npx vitest run functions/test/team-media-notification-batches.test.js tests/unit/media-award-notification-contract.test.js --reporter=verbose`
- `npm run test:functions:notifications`

## Residual Risks

- One slow fan-out can overrun the application budget before control returns.
- Released failures intentionally defer to the next invocation.
- Return shape changes from a results array to a summary containing `results`.

## Commit Message Draft

`Drain team media notification backlog (#4583)`
