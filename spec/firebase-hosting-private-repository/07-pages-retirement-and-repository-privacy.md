# Pages Retirement and Repository Privacy

Status: Proposed

Depends on: Specifications [1](./01-target-state-and-public-boundaries.md), [2](./02-ci-and-deployment-architecture.md), [3](./03-identity-secrets-and-trust.md), [4](./04-actions-cost-and-retention.md), [5](./05-paulbot-private-repository-operation.md), and [6](./06-firebase-domain-and-dns-cutover.md)

## Objective

Retire GitHub Pages without creating a custom-domain takeover path, make the repository private with expected controls intact, and validate every private integration before normal development resumes.

## Requirements

1. Pages retirement begins only after the Firebase custom domain has passed the maximum DNS TTL plus 24 continuous stable hours, all required product checks pass, and the owner explicitly approves the irreversible phase.
2. Authoritative DNS and independent public resolvers must show no apex or `www` route to GitHub Pages before the Pages custom-domain binding is removed or repository visibility changes.
3. Unpublish the Pages site through the provider, remove the custom-domain binding/CNAME artifact, remove Pages deployment permissions and environment references, and remove or repurpose every Pages publication workflow.
4. Re-read GitHub Pages state after each mutation. A timed-out or failed response is ambiguous until an authoritative read proves whether the change committed.
5. Validate that the former Pages hostname and any repository-derived Pages URL do not present the custom domain as an active binding. Monitor for takeover warnings during the retirement interval.
6. Capture the final public repository settings, branch protection, required-check producers, collaborators, Apps, Actions policy, environments, Pages state, security features, releases, forks, stars/watchers, and active work in the private operator record immediately before visibility changes.
7. PaulBot must be in `private-cutover`, with zero active mutations and merges disabled. Human merges and unrelated workflow dispatches remain frozen.
8. Make the repository private only through a human GitHub operation performed by a member of the authoritative immutable-ID owner allowlist in the private operator record, on the verified repository. Repository write access, PaulBot, and workflow execution are insufficient authority. Re-read actor identity, visibility, and repository identity; fail closed if any read is missing or ambiguous.
9. Immediately verify the default branch still has the intended protection, required checks, admin enforcement, force-push/deletion denial, and expected check-source bindings. Missing protection is a release-blocking incident.
10. Verify environments, environment secrets/variables, OIDC, repository variables/secrets, collaborators, GitHub Apps, webhooks, Dependabot, Actions policies, and security tooling from their authoritative APIs or settings.
11. Confirm unauthenticated clone/archive/API reads fail, intended collaborators can clone, unintended accounts cannot, and private issue/PR/Actions links require access.
12. Execute private canaries in order: read-only repository inventory, ordinary branch and PR, stable CI contexts, trusted preview, PaulBot test branch/PR/status/comment, allowlisted-owner-dispatched and environment-approved no-op production release, receipt-bound authenticated post-deploy smoke, recovery health, and nonpublishing mobile identity check.
13. A failed private integration does not justify republishing the repository. Keep the repository private, freeze the affected capability, and repair it through an owner-controlled private path.
14. Public forks remain detached and public, existing copied source remains public, stars/watchers may be erased, Pages is automatically unavailable on unsupported private plans, and public code scanning may become unavailable. Completion communications must state these consequences accurately.
15. Active public external claims and public-fork contributions must be closed, transferred, or explicitly abandoned before privacy. No bot may continue them through a detached repository relationship.
16. Existing application origins, OAuth callbacks, Firebase Auth authorized domains, App Check registrations, CSP, email links, mobile deep links, and public documentation are updated only where the host transition requires it.

## Design

### Pages retirement sequence

Retire routing first, provider binding second, workflow capability third, and repository visibility last. This order follows GitHub's warning that making a Free repository private automatically unpublishes Pages and can leave a custom domain exposed if DNS still targets GitHub. The operator records an authoritative result after every step.

### Visibility confirmation

The visibility change is high consequence and difficult to reverse cleanly because public/private transitions alter forks, watchers, logs, security features, and collaboration. The confirmation screen must be matched against the expected repository identity and preceded by a private operator checkpoint. No automation receives this authority.

### Private canaries

Canaries progress from least to most authority. A read failure blocks writes; a branch/CI failure blocks bot mutation; a preview failure blocks release testing; an environment/OIDC failure blocks production; a cost or protection failure blocks resuming automation. Canaries use disposable, clearly named test state and clean it up only after authoritative verification.

### Security tooling

Dependency graph and Dependabot behavior are rechecked. If code scanning or another public-only feature becomes unavailable, an accepted alternative or paid capability must be active before normal merges resume. Related passive repository-security guardrail work should land or receive an explicit disposition before cutover, but this specification does not modify those claimed files.

## Private canary matrix

| Canary | Success evidence | Failure posture |
|---|---|---|
| Visibility/access | Private API state; anonymous denial; intended clone | Keep private; correct access |
| Branch protection | Missing/foreign checks rejected | Freeze all merges |
| PR CI | Stable contexts on exact private head | Freeze merges; diagnose CI/plan |
| Preview | Trusted private preview with OIDC | Disable preview; do not broaden secrets |
| PaulBot | Scoped test operations and gate | Return bot to `private-cutover` |
| Production no-op | Allowlisted actor/approval and receipt-bound exact-SHA evidence | Freeze releases; repair identity/environment |
| Product smoke | Canonical Firebase origin passes | Firebase rollback/forward fix |
| Recovery/mobile | Required secrets/roles readable; no external publish | Disable affected lane |
| Cost | Usage ledger and alerts receive private activity | Enter `budget-guard` |

## Tasks

- [ ] Obtain the observation-window evidence and explicit Pages-retirement approval.
- [ ] Confirm no authoritative or sampled public DNS response targets Pages.
- [ ] Unpublish Pages, remove its custom-domain binding and artifact, and re-read final provider state.
- [ ] Remove all Pages deployment actions, workflows, permissions, environments, and release dependencies.
- [ ] Capture the final public repository/protection/integration snapshot privately.
- [ ] Drain PaulBot and human mutations; verify zero active external claims that depend on public access.
- [ ] Make the verified repository private through an owner-confirmed operation.
- [ ] Re-read visibility, protection, environments, integrations, security tooling, and access controls.
- [ ] Execute every private canary in order and record sanitized outcomes.
- [ ] Resume merges, releases, and PaulBot gradually only after every blocking canary passes.

## Rollback

There is no normal rollback from private to public. If a private integration fails, keep the repository private and repair access, plan, workflow, credential, or provider configuration. If production hosting fails, roll Firebase back to a known-good release. Pages is not restored after retirement. Re-publicizing the repository requires a new security and disclosure review and is outside this migration plan.

## Public sources

- [Consequences of changing repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
- [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
