# Requirements Role Synthesis (fallback; subagent infra unavailable)

## Objective
Ensure one live practice voice note creates exactly one visible note entry in drill notes.

## Current vs Proposed
- Current: Live note appends to both `notesLog` and `notes`, while UI renders both.
- Proposed: Live note appends only to `notesLog`; `notes` remains static/planned drill context.

## Acceptance Criteria
- One voice transcript event adds one entry to `notesLog`.
- `notes` field is not mutated by live note append path.
- Practice notes render still includes planned/static notes (`notes`) and live log entries (`notesLog`) without duplication from a single append.

## Risks
- Legacy data may already contain duplicated values in both fields; this fix prevents new duplicates but does not auto-migrate old records.
