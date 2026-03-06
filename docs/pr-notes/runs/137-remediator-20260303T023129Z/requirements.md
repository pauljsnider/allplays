# Requirements role (inline fallback)

Subagent orchestration tools/skills are unavailable in this execution context, so this is an inline requirements pass.

## Objective
Resolve unresolved PR feedback threads about XSS in `help.html` caused by direct interpolation into `innerHTML`.

## Required behavior
- Escape untrusted text interpolated into results cards (`id`, `title`, `summary`, workflow list items).
- Escape/encode values interpolated into bottom nav anchor `href` and anchor text.
- Keep functional behavior intact: search filtering and section navigation must still work.

## Scope constraints
- Minimal targeted changes in `help.html` only.
- No unrelated refactors.
