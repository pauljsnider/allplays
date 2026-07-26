# AllPlays landing process

AllPlays supports concurrent work by humans, Codex sessions, and PaulBot while
serializing the expensive final integration step.

## Ownership

1. Add `external-claim` to an issue and its pull request before working from a
   machine or agent session outside PaulBot.
2. Keep the label while commits and review fixes are still being pushed.
3. Remove `external-claim` only when the head is ready to freeze and land.
4. PaulBot then applies `paulbot-automerge`, updates at most one landing branch
   against `master`, completes the current-head review, waits for required
   checks, and merges it.

Do not push additional commits after handing a pull request to the landing
worker. If more development is necessary, restore `external-claim` first.

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
changes do not cancel or restart code validation. At handoff PaulBot consumes
the frozen exact head's existing results and narrowly wakes a missing current
head check only when necessary; `paulbot-review-gate` and the mutation gate
prevent a claimed PR from entering automated landing.

## Pull request sizing

Prefer pull requests below 500 changed lines and 20 changed files. Split larger
features into independently testable slices. A larger PR should explain why it
cannot be split and should not enter landing while another large PR is active.
