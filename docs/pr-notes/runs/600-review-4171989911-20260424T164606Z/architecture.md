# Architecture

## Current State
`organization-schedule.html` built select options and the success banner with string interpolation into `innerHTML`. Team names are user-editable, so this created a stored XSS path in an admin-facing scheduling workflow.

## Proposed State
Use DOM APIs for option and link creation:
- `document.createElement('option')` with `textContent` for team labels
- `document.createElement('a')` with direct `href` assignment for success actions
- `replaceChildren()` to rebuild containers safely without HTML parsing

## Security/Blast Radius
- Current blast radius: any admin loading the organization schedule screen for a poisoned team record could execute attacker-supplied markup/script.
- Proposed blast radius: user-controlled names stay text-only in this flow, eliminating HTML execution from this entry point.

## Controls/Tradeoffs
- This keeps the static-site architecture intact and does not depend on backend filtering.
- DOM construction is slightly more verbose than templated HTML, but it is the lowest-risk fix and aligns with browser-native escaping behavior.
- `encodeURIComponent` on team ids protects the generated schedule links from malformed hash content.

## Rollback
Revert the single-file UI change and test additions if a regression appears. No data migration or backend rollback is required.
