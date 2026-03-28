# Requirements Role (allplays-requirements-expert equivalent fallback)

Requested orchestration skill `allplays-orchestrator-playbook`, role skill `allplays-requirements-expert`, and `sessions_spawn` are unavailable in this runtime. This artifact captures equivalent requirements analysis.

## Objective
Add a deterministic CSV schedule import flow to `edit-schedule.html` that supports field mapping, row validation, pre-save correction, and optional notifications.

## Current state
- Coaches can add games and practices manually.
- Schedules can be ingested from external `.ics` links.
- Bulk AI parsing exists for pasted text or uploaded images.
- There is no structured CSV upload path, no header mapping, and no validation review before save.

## User expectation
- A coach uploads a CSV and sees the detected headers immediately.
- Required fields can be mapped explicitly, with reasonable auto-detection for common exports.
- Invalid rows are flagged before save and can be corrected inline.
- Saving creates schedule entries without AI ambiguity.
- Team notification after import is optional, not forced.

## Scope
- Client-side CSV parsing and field mapping.
- Preview model that distinguishes games vs practices.
- Row-level validation for missing/invalid values.
- Save flow using existing `addGame` / `addPractice` helpers.
- Focused unit coverage for parser/validation logic and page wiring.

## Out of scope
- Server-side file processing.
- CSV update/merge semantics against existing events.
- Automatic dedupe against current schedule.
- Recurring practice import.

## Success criteria
- Tests fail before implementation and pass after.
- `edit-schedule.html` exposes a CSV import entry point with mapping and preview.
- Import blocks on validation errors and allows inline correction.
- Imported rows write through existing schedule storage paths.
