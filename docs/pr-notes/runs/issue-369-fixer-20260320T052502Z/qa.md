# QA Role (allplays-qa-expert equivalent fallback)

Requested orchestration skill `allplays-orchestrator-playbook`, role skill `allplays-qa-expert`, and `sessions_spawn` are unavailable in this runtime. This artifact captures equivalent QA analysis.

## Primary risks
- Ambiguous date/time parsing creates wrong event timestamps.
- A mapped CSV row could create a game without an opponent or a practice without a usable title.
- Inline edits in preview could drift from the persisted payload.
- UI wiring could regress tab switching or fail to expose the import controls at all.

## Regression guardrails
- Unit tests for:
  - quoted CSV parsing
  - header inference
  - row normalization for games and practices
  - validation errors for missing opponent / invalid time
  - page wiring assertions for the new CSV tab and controls

## Manual validation targets
- Upload a CSV with standard headers and import one game plus one practice.
- Upload a CSV with mismatched headers and remap them manually.
- Confirm invalid rows block save until corrected.
- Confirm optional team notification can be toggled off/on.
- Confirm existing Game, Practice, and AI tabs still work.
