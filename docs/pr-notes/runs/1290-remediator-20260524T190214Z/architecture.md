# Architecture

## Decision
Keep `requireSyncedAuth()` page-local in `dashboard.html` and keep using `checkAuth()` so dashboard benefits from profile enrichment and parent membership sync.

## Cleanup Pattern
- Track `unsubscribePending` when a synchronous callback fires before `checkAuth()` returns the unsubscribe function.
- Track `settled` so only the first auth emission resolves or rejects the one-shot wrapper.
- Centralize listener cleanup in a local `cleanup()` helper.

## Risk And Rollback
- Risk is limited to dashboard auth initialization.
- Rollback is the previous `requireSyncedAuth()` implementation, but that restores the listener leak risk.
