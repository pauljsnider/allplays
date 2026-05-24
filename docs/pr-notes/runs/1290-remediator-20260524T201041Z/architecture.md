# Architecture

## Decision
Use a one-shot auth gate that tracks whether cleanup was requested before the unsubscribe function is available.

## Rationale
Firebase-style auth observers may invoke callbacks synchronously. The dashboard needs the rich `checkAuth` user object, but it only needs the first emission before loading team data. A small pending-cleanup flag keeps the unsubscribe lifecycle deterministic without changing the surrounding page boot flow.

## Risk And Rollback
- Risk: double cleanup if auth emits multiple times. Mitigation: `settled` guard plus nulling the unsubscribe function before invocation.
- Rollback: revert the `requireSyncedAuth()` block and associated regression test if auth initialization regresses.
