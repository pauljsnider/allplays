Validation target:
- Undo a stat when current total is at least the logged value: viewer should receive the full negative delta.
- Undo a stat after prior corrections reduced the current total below the logged value: viewer should receive only the remaining reversible amount.
- Undo a stat when current total is already zero: viewer should not receive a negative delta.

Regression watch:
- Point-like stats (`pts`, `points`, `goals`) must roll back `homeScore` or `awayScore` by the same effective delta used for the stat event.
