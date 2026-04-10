# Code role plan (inline fallback)

Subagent orchestration tools/skills are unavailable in this execution context, so this is an inline code plan.

## Planned edits
- Update `help.html` script to add two helpers:
  - `escapeHtml(value)`
  - `toSafeFragmentId(value, index)`
- Replace direct interpolation with escaped/safe values in:
  - `results.innerHTML`
  - `bottomNav.innerHTML`

## Commit scope
- Files: `help.html`, role notes under `docs/pr-notes/runs/137-remediator-20260303T023129Z/`
