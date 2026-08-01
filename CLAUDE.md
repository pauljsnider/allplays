@AGENTS.md

# Claude Code Adapter

`AGENTS.md` is the canonical repository contract. Follow it in full, including
the exact-head `external-claim`/PaulBot handoff and the CI trust boundaries.

- When working under `apps/app/`, also read and follow `apps/app/AGENTS.md`.
- Use the evidence-backed references under `docs/codebase/` for architecture,
  integrations, tests, CI, and known risks instead of inferring from filenames.
- Treat Claude auto-memory as personal convenience only. Do not store shared
  repository policy there; update `AGENTS.md` or `docs/codebase/` instead.
- Do not mark a PR ready, remove `external-claim`, push after handoff, or merge
  unless the user explicitly assigns that ownership and the canonical handoff
  steps have been satisfied.
- Before reporting completion, state the exact validation run and distinguish
  local producer completion from PaulBot landing completion.
