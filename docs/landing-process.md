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

- Fast PR checks (`unit-tests`, `cache-bust-guard`, `app-quality`, and focused
  regression guards) provide feedback while development is active.
- Native Android/iOS builds, full preview smoke, and preview artifact creation
  are deferred while `external-claim` is present.
- Removing `external-claim` triggers the full applicable integration checks.
- Production deployment remains a post-merge `master` workflow.

The stable aggregate contexts `mobile-build` and `preview-smoke` report a
successful deferral while a claim is active. They rerun the real integration
work on the same head when the claim is removed; `paulbot-review-gate` and the
PaulBot mutation gate prevent a claimed PR from entering automated landing.

## Pull request sizing

Prefer pull requests below 500 changed lines and 20 changed files. Split larger
features into independently testable slices. A larger PR should explain why it
cannot be split and should not enter landing while another large PR is active.
