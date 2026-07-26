# ALL PLAYS landing process

ALL PLAYS supports concurrent work by humans, Codex sessions, and PaulBot while
serializing the expensive final integration step.

## Ownership

`external-claim` is controller ownership metadata.

1. Add `external-claim` to an issue and its pull request before working from a
   machine or agent session outside PaulBot.
2. Keep the label while commits and review fixes are still being pushed.
3. Remove `external-claim` only when the head is ready to freeze and land.
4. PaulBot then applies `paulbot-automerge`, updates at most one landing branch
   against `master`, completes the current-head review, waits for required
   checks, and merges it.

Do not push additional commits after handing a pull request to the landing
worker. Before handoff, the current producer may restore `external-claim` when
more development is necessary. After handoff, a Codex, Claude, Q, or human
coding session must not restore the label or reclaim remediation in response to
a PaulBot finding. Only an explicit operator-requested ownership transfer may
return the pull request to an external producer; otherwise PaulBot remains the
sole writer through review, remediation, checks, and merge.

## CI stages

- Fast PR checks (`unit-tests`, `cache-bust-guard`, `app-quality`, and focused
  regression guards) run for applicable code-head events.
- Native Android/iOS builds, full preview smoke, and preview artifact creation
  also run when the changed paths require them, regardless of ownership label.
- Adding or removing `external-claim` does not launch, cancel, or replace CI.
- Production deployment remains a post-merge `master` workflow.

The stable aggregate contexts `mobile-build` and `preview-smoke` preserve
branch-protection signals across path-filtered jobs. When `external-claim` is
removed, PaulBot consumes the existing results for the frozen exact head. If an
applicable current-head check is missing or canceled, the controller narrowly
wakes or reruns that check. `paulbot-review-gate` and the PaulBot mutation gate
prevent a claimed PR from entering automated landing.

## Pull request sizing

Prefer pull requests below 500 changed lines and 20 changed files. Split larger
features into independently testable slices. A larger PR should explain why it
cannot be split and should not enter landing while another large PR is active.
