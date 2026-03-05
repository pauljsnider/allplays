# Requirements Role Notes

Thinking level: medium (two tightly scoped review findings with cross-file behavior implications).

## Objective
Address unresolved PR #171 review threads only.

## Required outcomes
- Reset helper test must reflect actual reset usage semantics (scores cleared to zero in reset flow).
- Pre-start fresh-start branch must delete `liveEvents` before broadcasting reset to avoid stale reprocessing in viewers.

## Scope boundaries
- No refactors.
- No behavior changes outside reset/test paths called out in review feedback.
