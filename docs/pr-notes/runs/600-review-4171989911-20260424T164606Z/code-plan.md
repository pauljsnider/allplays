# Code Plan

## Findings
- Codex review correctly flagged `renderTeamOptions` for stored XSS because it interpolated user-controlled `team.id` and `team.name` into `selectEl.innerHTML`.
- The adjacent `renderSuccess` helper also interpolated team names and ids into `innerHTML`, so leaving it unchanged would preserve a similar browser-side injection path in the same flow.

## Minimal Patch Plan
1. Replace select option HTML string building with DOM-created `option` elements using `value` and `textContent`.
2. Replace success banner HTML string building with DOM-created nodes and direct `href`/`textContent` assignments.
3. Add focused regression tests that assert this page no longer uses those unsafe string-building patterns.

## Test Additions
- Extend `tests/unit/organization-schedule.test.js` with source-level assertions for safe option rendering and safe success banner rendering.

## Risks
- Low. Main regression risk is accidentally changing default selections or success link labels, which is covered by diff review and targeted test updates.
