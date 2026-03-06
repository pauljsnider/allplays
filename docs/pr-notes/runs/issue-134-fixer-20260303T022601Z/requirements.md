# Requirements Role Synthesis (fallback)

## Note on orchestration
Requested skills/sessions were unavailable in this runtime (`allplays-orchestrator-playbook`, role skills, `sessions_spawn`). This file captures equivalent role analysis.

## Objective
Deliver a first shippable, role-aware help system entry point that is accessible, searchable, and reachable from existing app navigation with minimal blast radius.

## Current state
- No dedicated help center page exists.
- Footer “Help Center” link is a dead `#` target.
- No shared role-aware help content source.

## Proposed state
- Add `help.html` with:
  - Search input and role picker.
  - Role-aware rendered help sections.
  - Accessible section semantics (`main`, labeled controls, headings, list structure).
  - Bottom in-page navigation for fast section access on mobile/desktop.
- Add shared content module enumerating required role + workflow coverage categories.
- Add context-aware “Help” link to team navigation banner.
- Update global footer Help Center link to point at `help.html`.

## Risks and blast radius
- Low; static-page and shared-nav additions only.
- No auth, Firestore, or write-path changes.
- Main UX risk: content incompleteness; mitigated by explicit section scaffolding and glossary.
