# Architecture analysis

The requested `allplays-architecture-expert` skill was unavailable, and the
required role subagent failed before execution with no runtime. This fallback
analysis applies the requested senior Firebase architecture role.

## Root cause

Aggregate verification accepts only one attempt's evidence. Replacing that
array on an exact-artifact retry loses valid per-target results, while blindly
combining attempts could allow non-terminal or missing evidence to appear
complete.

## Minimal design

- Add optional `previousEvidence` only to aggregate function verification.
- Index current and previous attempt evidence independently by project and
  function target, retaining duplicate and unexpected-target rejection inside
  each attempt.
- Select prior terminal (`updated` or `unchanged`) evidence first so an already
  valid result remains stable; use current terminal evidence only to fill a
  target with no prior terminal result.
- Validate selected evidence against the same expected artifact SHA and
  deployment identity through the existing individual verifier.
- Preserve the existing deterministic incomplete-target error when neither
  attempt has terminal evidence for an intended target.

This is in-memory verification only and does not add retry orchestration.
