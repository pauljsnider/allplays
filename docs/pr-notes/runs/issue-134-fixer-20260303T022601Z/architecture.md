# Architecture Role Synthesis (fallback)

## Chosen design
- `js/help-center.js`: pure helper module for role normalization, role-aware section filtering, and search.
- `help.html`: static host page that renders searchable knowledge-base content from helper module.
- `js/team-admin-banner.js`: add `help` destination card (context + role query params).
- `js/utils.js`: fix footer Help Center route (`help.html`).

## Why this design
- Keeps logic testable in pure JS (Vitest-friendly).
- Constrains change to shared UI entry points + new page.
- Provides extensibility for future feature-release content updates.

## Accessibility controls
- Proper `label`/`for` on controls.
- Landmarks (`main`, `nav`) and semantic headings.
- High-contrast defaults inherited from existing palette.

## Rollback
- Revert new help files and two shared-nav edits.
