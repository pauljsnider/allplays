# Requirements

## Acceptance criteria
- Same-browser resume must not double-count active lineup time already captured in the local tracker snapshot.
- Running-clock display may still advance using persisted game-clock elapsed time.
- Active lineup time should only receive elapsed time after the local snapshot `savedAt`, clamped to zero.
- No-local-snapshot/cross-device resume should keep existing behavior and credit active lineup time from persisted running-clock elapsed time.
- Paused games must not add lineup elapsed time.

## Non-goals
- No redesign of tracker persistence.
- No Firestore schema/rules changes.
- No lineup, substitution, fairness, or opponent-stat behavior changes.
