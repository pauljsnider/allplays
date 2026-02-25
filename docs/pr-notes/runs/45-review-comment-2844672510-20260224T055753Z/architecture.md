# Architecture Role Summary

## Current state
`canTrustScoreLogForFinalization` inferred trust from live score parity, but parity can still hold with a partial resumed log.

## Proposed state
Add explicit state flag `scoreLogIsComplete` in both trackers:
- Initialize `true` for fresh sessions.
- Set `false` whenever tracker state is resumed/seeded from persisted score/stat/event data.
- Set `false` when user clears the log.
- Gate reconciliation on both `scoreLogIsComplete` and `canTrustScoreLogForFinalization(...)`.
- Preserve flag in undo snapshots.

## Blast radius comparison
- Previous: possible incorrect score overwrite at completion.
- New: reconciliation disabled unless completeness is known, preserving requested/live score in uncertain resume paths.
