# Architecture Role Synthesis (fallback; subagent infra unavailable)

## Root Cause
`appendPracticeNote` mutates overlapping fields:
- canonical event stream: `block.notesLog.push(...)`
- static summary text: `block.notes = ... + clean`

`renderPracticeDrill` emits both `notesLog` and `notes`, yielding duplicate visual output for a single live note.

## Minimal Safe Change
- Remove `block.notes` mutation in `appendPracticeNote`.
- Keep persistence as-is (`state.canvasBlocks` persisted), so `notesLog` remains source of truth for live notes.
- Keep rendering logic unchanged to preserve display of pre-authored `notes`.

## Blast Radius
- Localized to practice note write path in `drills.html`.
- No auth, tenancy, or Firestore permission behavior changes.
