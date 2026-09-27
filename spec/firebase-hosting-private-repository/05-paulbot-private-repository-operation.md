# PaulBot Private-Repository Operation

Status: Proposed

Depends on: Specifications [1](./01-target-state-and-public-boundaries.md), [2](./02-ci-and-deployment-architecture.md), [3](./03-identity-secrets-and-trust.md), and [4](./04-actions-cost-and-retention.md)

## Objective

Keep PaulBot's issue-to-PR and review-closeout capabilities working in the private repository while preventing unsafe merges, production authority, credential leakage, and unbounded Actions cost.

## Impact summary

Authenticated GitHub App operations can continue after privacy if the App remains installed on the repository with the required repository-scoped permissions. Anonymous reads, public clones, public-fork contribution flows, and links usable without repository access stop working. Existing public forks detach and remain public, so PaulBot must treat them as unrelated repositories rather than trusted upstream work.

The largest operational impacts are not basic API access. They are loss or change of public-only GitHub features if the wrong plan is selected, private-link access for human notifications, Actions metering for bot-created work, visibility-sensitive credentials, and the risk that a bot merge could indirectly trigger production. This specification addresses those boundaries explicitly.

## Requirements

1. PaulBot authenticates with a repository-scoped GitHub App installation or equivalently narrow short-lived credential. It does not use anonymous access or a user-wide classic token.
2. The installation is verified before privacy for repository metadata, issue, pull request, branch, commit, check/status, review, and comment operations actually used by the bot. Unused administration and deployment permissions are removed.
3. PaulBot cannot change repository visibility, plan, billing, collaborators, App installations, Actions policy, secrets, environments, default-branch protection, DNS, Firebase, or production cloud resources.
4. PaulBot does not possess the production deployment identity and cannot dispatch a production release. Its merge decision may make a SHA eligible for an owner dispatch but cannot publish it.
5. Every merge remains server-enforced by private-repository branch protection on the recommended plan. PaulBot also independently requires the explicit stable check allowlist, expected check producers, exact current head, resolved review threads, accepted mergeability, current base, complete PR scope, and its own post-validation `paulbot-review-gate` success.
6. If branch protection, required checks, check identity, PR state, rate limits, or GitHub API completeness cannot be read authoritatively, PaulBot refuses the merge. A local policy is defense in depth, not a replacement for unavailable server enforcement.
7. PaulBot never pushes directly to `master`, force-pushes a ready review head, or merges a head that changed after its evidence was collected.
8. `external-claim` remains ownership metadata only. It does not trigger or restart CI, confer trust, or authorize a bot to adopt work from a detached public fork after privacy.
9. Public-fork pull requests and anonymous issue intake are explicitly retired or replaced by an authenticated support path. PaulBot processes only pull requests whose current repository, base, and head provenance match the private policy.
10. Notifications that contain private repository links go only to intended recipients and disclose no source snippets, tokens, credentials, private logs, or sensitive issue data in broadly visible channels.
11. Before visibility changes, PaulBot enters `private-cutover`: stop discovery and new leases, stop new branches/PRs, allow bounded closeout of safe existing work, and drain to zero active mutations before DNS/visibility execution.
12. After privacy, PaulBot resumes in stages: authenticated read-only inventory, shadow decisions, test-branch write, test PR/check/comment, safe closeout, then bounded discovery. Any failed stage returns to `private-cutover`.
13. `budget-guard` stops new noncritical discovery, repeated review refreshes, speculative branches, optional previews, and other avoidable Actions triggers. Security containment and explicitly owner-authorized production recovery remain separately governed.
14. The controller attributes Actions-triggering activity to bot work, caps concurrent active PRs and workflow fanout, batches compatible changes, and suppresses no-op comments/status rewrites.
15. Credential rotation and host recovery are tested without publishing hostnames, paths, ports, installation IDs, token scopes, or private health data. Those values remain in the private PaulBot/operator runbook.

## Operating states

| State | Discovery | Mutations | Merge | Production deploy |
|---|---|---|---|---|
| `normal` | Bounded | Allowed by lane policy | Exact-head gates required | Never |
| `budget-guard` | Paused except accepted critical lane | Existing critical closeout only | Exact-head gates required | Never |
| `private-cutover` | Paused | Drain then read-only | Disabled at zero-mutation gate | Never |
| `private-shadow` | Read-only | Test branch/PR only when explicitly enabled | Disabled | Never |
| `release-only` | Paused | No bot-authored product work | Disabled | Never |

State changes are durable, visible to the controller and operator, and idempotent. A restart must not revert a restrictive state to `normal` merely because memory is empty.

## Private cutover protocol

1. Announce a bounded automation freeze through existing private operator channels.
2. Stop discovery, scheduling, lease acquisition, branch creation, and PR creation.
3. Inventory active leases, branches, PR mutations, queued comments/statuses, and workflow dispatches.
4. Finish only changes whose exact head and validation can complete before the freeze deadline; otherwise release or retain them explicitly without mutation.
5. Prove zero active bot mutations and no pending merge at the DNS rehearsal gate.
6. Keep authenticated read/health checks available unless they create provider cost or interfere with cutover.
7. After privacy, execute canaries in the staged resume order and compare observed repository identity to the expected private repository on every step.
8. Resume bounded normal work only after branch protection, CI identity, cost state, notifications, and private-link access all pass.

## Verification matrix

| Behavior | Required regression |
|---|---|
| Authentication | Private metadata read succeeds; unrelated repository read fails |
| Branch work | Test branch/commit/PR succeeds; direct `master` update fails |
| Check trust | Expected exact-head producers accepted; same-name foreign/stale checks rejected |
| Review closeout | Unresolved, stale-base, changed-head, partial API, and nonmergeable cases fail closed |
| Visibility | Detached public fork and wrong repository provenance rejected |
| Deployment separation | Bot cannot access deploy credential or production dispatch |
| Cutover | Restart preserves pause; drain reaches zero; queued mutation cannot escape pause |
| Cost | Burst workload activates `budget-guard`; no-op refreshes do not trigger CI |
| Notifications | Private links restricted; logs/comments contain no private operational data |

## Tasks

- [ ] Inventory PaulBot's actual GitHub API and Git operations and map each to the narrowest App permission.
- [ ] Verify repository installation and credential rotation while the repository remains public.
- [ ] Add exact-repository, exact-head, expected-check-producer, branch-protection, mergeability, and review-thread fail-closed tests.
- [ ] Add an explicit production-dispatch denial and prove no cloud deployment credential reaches PaulBot.
- [ ] Implement durable `private-cutover`, `private-shadow`, `budget-guard`, and `release-only` states.
- [ ] Add active-work draining, zero-mutation evidence, restart persistence, and queued-mutation cancellation tests.
- [ ] Add workflow-cost attribution, active PR caps, batching, and no-op update suppression.
- [ ] Audit notifications and replace public-link assumptions with access-aware messaging.
- [ ] Execute the staged private canary and record sanitized pass/fail evidence.

## Rollback

A PaulBot failure after privacy does not justify making the repository public. Return the bot to `private-cutover`, revoke or rotate its repository credential if integrity is uncertain, preserve active branch/PR state, and continue owner-operated repository and production workflows. Resume only from a new authoritative private inventory and successful canary sequence.

## Public sources

- [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [Required status check behavior](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/merging-a-pull-request-with-a-merge-queue/troubleshooting-required-status-checks)
- [Fork visibility and permissions](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/about-permissions-and-visibility-of-forks)
