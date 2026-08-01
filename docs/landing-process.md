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

- `pr-fast` runs `unit-tests`, `cache-bust-guard`, and `app-quality` once for
  each opened, reopened, or synchronized code head.
- `pr-integration` calls the regression, path-filtered native, staged preview
  smoke, and untrusted preview-artifact workflows in one run. Its always-running
  `mobile-build` and `preview-smoke` aggregates fail closed.
- A successful same-repository `pr-integration` run triggers one
  `deploy-preview-trusted` run, which re-verifies the exact current head before
  any credentialed preview write.
- Production deployment remains a post-merge `master` workflow.

`external-claim` is controller ownership metadata, not a CI trigger. Label
changes do not launch, cancel, or replace CI. At handoff PaulBot consumes
the frozen exact head's existing results and narrowly wakes a missing current
head check only when necessary; `paulbot-review-gate` and the mutation gate
prevent a claimed PR from entering automated landing.

## Pull request sizing

Prefer pull requests below 500 changed lines and 20 changed files. Split larger
features into independently testable slices. A larger PR should explain why it
cannot be split and should not enter landing while another large PR is active.
