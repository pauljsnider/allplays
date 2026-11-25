# Requirements analysis

The requested `allplays-requirements-expert` skill was unavailable, and the
required role subagent failed before execution with no runtime. This fallback
analysis applies the requested UX, coaching, parent, and sports-manager role.

- A retry of the same exact artifact must preserve terminal target evidence
  already established by an earlier attempt.
- A later `unchanged` observation must not rewrite an earlier valid `updated`
  result for the same artifact and deployment identity.
- Retry evidence may fill a previously missing target only when it supplies a
  new authoritative `updated` or `unchanged` result.
- Missing or identity-only `current` evidence remains incomplete on every
  retry; retry count alone is never completion evidence.
- Hosting, scheduling, workflow gating, Pages, and release markers remain out
  of scope.

The acceptance regressions are a complete retry that preserves an earlier
target result and a repeated partial-quota retry that deterministically reports
the same missing target.
