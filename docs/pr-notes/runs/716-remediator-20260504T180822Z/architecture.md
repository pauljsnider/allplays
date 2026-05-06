# Architecture

## Decisions
- Enforce scorekeeper scope server-side in `firestore.rules`, not in client code.
- Keep `status` and `liveStatus` in the scorekeeper update allowlist because live scoring flows use non-destructive lifecycle transitions.
- Add an explicit lifecycle guard to reject destructive post-update document states for delegated scorekeepers.

## Risk And Rollback
- Blast radius is limited to delegated scorekeeper updates on `teams/{teamId}/games/{gameId}`.
- Admin and owner update paths are unchanged.
- Rollback is reverting the single Firestore rules change if a legitimate scorekeeper flow is blocked.
