# ALL PLAYS Amazon Q Review Rules

The canonical project, test, CI, security, and landing instructions are in
`AGENTS.md`; architecture evidence is in `docs/codebase/`. Apply these
review-specific rules in addition to them.

## Review Contract

- Review the current PR head SHA only. Never carry a green verdict or resolved
  finding forward after a new commit without rechecking the affected code.
- Automatic Amazon Q GitHub review does not repeat after later pushes. When Q
  review is required for a changed head, request `/q review` on that frozen SHA.
- Be review-only by default: do not commit, push, rebase, label, mark ready,
  merge, or invoke an automated fix unless the user explicitly assigns producer
  ownership and `external-claim` is present.
- After `external-claim` is removed, PaulBot is the sole landing writer. Report
  findings; do not compete with its remediation, branch update, or merge.

## Finding Format

- Prefix blocking findings with `[ACTIONABLE:P0]` through `[ACTIONABLE:P3]`.
  Include the exact path/line, failing scenario, repository evidence, and the
  smallest useful validation.
- Prefix compliments, summaries, optional ideas, and questions with
  `[NO-ACTION]`. Do not phrase a positive summary so PaulBot can mistake it for
  remediation work.
- Do not request broad refactors, speculative defensive code, or tests unrelated
  to the changed behavior. Prefer one precise finding over repeated variants.
- Explicitly say `No actionable findings on <sha>` when the current head passes
  review.

## High-Risk Review Areas

- Auth and authorization: client checks never replace `firestore.rules`,
  `storage.rules`, verified-email policy, entitlement checks, or App Check.
- Shared contracts: search legacy `js/`, React adapters/services, tests,
  Functions, rules, and MCP field whitelists for every changed field or payload.
- React/Capacitor: shared behavior stays in `apps/app/src`; native shells and
  adapters remain thin and platform differences are deliberate.
- Runtime config: preserve hosted, inline, and bundled fallback behavior without
  logging keys, tokens, passwords, cookies, or user email.
- GitHub Actions: preserve least-privilege permissions, pinned actions,
  credential-free PR builds, sanitized artifacts, OIDC-after-validation, and
  exact-current-head verification in trusted preview/production jobs.
- CI: distinguish a genuine current-head failure from an obsolete canceled run,
  a path-filtered skip, or a successful stable aggregate (`mobile-build` or
  `preview-smoke`).
