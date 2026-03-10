Decision: Fix the stale clock at the source of truth, the game document reset update.

Why this path:
- Minimal blast radius. No need to change resume derivation semantics for valid resume cases.
- Matches user intent. Cancel/start over should zero both the event stream and the persisted clock snapshot.
- Avoids introducing additional resume-state flags or wider data-model changes.

Control comparison:
- Before: reset cleared event collections but preserved old live clock metadata.
- After: reset clears both the collections and the persisted live clock metadata, so the next load cannot restore stale progress.

Rollback: Revert the single reset-path patch if it causes an unexpected dependency on previous clock metadata.
