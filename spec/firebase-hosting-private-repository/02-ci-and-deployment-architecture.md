# CI and Deployment Architecture

Status: Proposed

Depends on: Specification [1](./01-target-state-and-public-boundaries.md)

## Objective

Preserve exact-head validation and trusted deployment boundaries after the repository becomes private while removing GitHub Pages and preventing ordinary merges or PaulBot from acquiring production authority.

## Requirements

1. `pr-fast` and `pr-integration` remain the only pull-request event entrypoints. Legacy reusable workflows remain reusable/manual and must not regain competing pull-request triggers.
2. Stable contexts remain `unit-tests`, `cache-bust-guard`, `app-quality`, `mobile-build`, `preview-smoke`, and `paulbot-review-gate`. Each required context must still bind to the expected GitHub App or Actions identity on the exact current head.
3. The untrusted preview builder remains separate from the trusted OIDC deployer. No privileged workflow may execute pull-request code merely because the repository is private.
4. `pull_request_target`, unchecked artifact downloads, mutable action tags, interpolated untrusted shell input, and write-all token permissions are prohibited.
5. Every action is pinned to a full commit SHA, top-level and job-level token permissions are deny-by-default, and write permissions are limited to the job that needs them.
6. Production deployment becomes an explicit owner-authorized `workflow_dispatch` bound to an immutable commit SHA. The authoritative owner set is a change-controlled allowlist of immutable GitHub user IDs in the private operator record. The workflow accepts only a first-attempt dispatch whose immutable actor ID is in that set and whose repository ID, event, workflow version, protected `master` ref, and requested target SHA match the release contract; it fails closed when any identity, claim, ref, or allowlist lookup is missing or ambiguous. The only job permitted to request the production cloud identity runs inside a reusable release controller invoked at a full commit SHA. An independently administered cloud OIDC/WIF condition enforces the immutable repository ID, dispatch event, first run attempt, owner actor-ID allowlist, exact `job_workflow_ref`, and exact `job_workflow_sha` for that audited controller. No mutable branch, tag, workflow path, or repository variable can substitute for the controller SHA. The production environment still restricts branches and scopes secrets, but required environment-reviewer approval is optional defense in depth only when a private-plan preflight proves it is available. A push to `master`, a merge, a rerun, a PaulBot decision, a repository writer outside the owner set, or a scheduled workflow may validate readiness but may not publish production by itself.
7. The production dispatcher verifies that the requested SHA is reachable from `master`, is the intended exact merge SHA, has the complete trusted validation set, has no newer unaccepted production dependency, and matches the staged artifact manifest.
8. The production workflow remains the only live writer for Hosting, Functions, Firestore rules/indexes, and Storage rules. Component ordering, partial-failure gates, release markers, and post-deploy smoke remain coupled. `deploy-prod` emits an immutable deployment receipt containing the authoritative requested target SHA, deployment run ID/attempt, and staged-manifest digest; the smoke workflow consumes that receipt, checks out and verifies that target SHA, and records the same identities. It must not substitute `workflow_run.head_sha` or the dispatch ref for the requested release SHA.
9. During DNS observation, the production workflow may publish the same exact staged site artifact to both Firebase and Pages. It must never build a second Pages-specific source tree that can drift.
10. After the Pages retirement gate, all Pages jobs, artifacts, permissions, environments, CNAME staging, deployment records, and manual publication workflows are removed or converted to nonpublishing validation.
11. Spec-only pull requests retain their typed no-op release behavior and stable wrapper checks without consuming dependency-heavy suites.
12. Production and preview artifacts contain a manifest with source SHA, workflow run identity, build command/version, file inventory hash, configuration hash, and producer trust classification. The trusted deployer validates all fields before publishing.
13. Private pull requests from intended collaborators must preserve current validation. Fork-based public contribution is not assumed after privacy; no secret-bearing job may run automatically for an untrusted fork.
14. A failed or skipped required job is never converted into success by a wrapper unless the impact classifier proves the job intentionally does not apply and the wrapper records that typed result.

## Design

### Pull-request control plane

Keep change classification at the front of both PR entrypoints. Consolidate work inside the existing stable contexts so branch protection does not churn as implementation changes. Heavy reusable workflows receive only the exact pull-request head and emit verifiable artifacts and summaries. The PaulBot status is an independent decision signal, not a substitute for test contexts.

### Trusted preview path

The same-repository, ready-PR dispatch contract remains: an unprivileged build produces a bounded artifact; a default-branch workflow independently re-reads current PR state, head SHA, integration result, artifact identity, and repository provenance; only then does the OIDC-backed job deploy a fixed preview channel. Private visibility does not justify collapsing those trust zones.

### Production path

The release controller stages one immutable artifact and deploys components in their established safe order. The owner dispatch supplies or selects the exact merge SHA, and the immutable reusable controller reuses exact-head PR evidence only when every identity and tree invariant matches. `--ref` selects the caller workflow version; it does not identify the release candidate or authorize the credential-bearing controller. The caller invokes the controller by full commit SHA, and the cloud provider independently requires the matching `job_workflow_ref` and `job_workflow_sha`. The requested release SHA remains a separate validated input and is carried in the deployment receipt into post-deploy smoke and release evidence. The workflow gate and independently administered cloud identity condition both require the private immutable owner-ID allowlist and reject reruns; repository write access alone is not production authority, and PaulBot must not gain indirect deployment authority by merging. Environment approval may strengthen this boundary on a plan that supports required reviewers for private repositories, but the GitHub Pro baseline does not depend on it.

Changing the reusable controller requires a controlled trust-root rotation. An owner reviews and accepts the new controller at an exact SHA; an independently authorized cloud IAM operator temporarily adds only that exact `job_workflow_sha`/full-SHA `job_workflow_ref` alongside the current value; a no-op canary proves the new SHA is accepted and an unlisted SHA is denied; the dispatcher is pinned to the new SHA; and the old provider value is removed after bounded observation and recovery validation. Every provider read and write is recorded privately and re-read authoritatively. If GitHub or the selected provider cannot expose and enforce the immutable reusable-workflow claim, production migration stops rather than falling back to a mutable ref.

### Pages transition

Before DNS cutover, Pages remains the canonical output and Firebase is the candidate. During observation, Firebase is canonical and Pages is a rollback output. After the observation gate, Pages is removed from the release graph entirely. Pages retirement is a discrete change with tests proving no workflow can call the Pages deploy action or publish the custom-domain artifact.

## Verification matrix

| Layer | Required evidence |
|---|---|
| PR fast lane | Exact-head stable contexts, spec-only routing, concurrency cancellation, read-only default token |
| PR integration | Ready-head gating, reusable workflow identities, mobile and preview typed outcomes |
| Trusted preview | Same-repository PR, current head, passed integration, verified artifact, claim-bound OIDC |
| Production dispatch | Workflow and cloud-provider owner-ID gates, full-SHA reusable controller, provider-matched `job_workflow_sha`, first-attempt dispatch, immutable requested SHA, reachable merge, complete trusted evidence, one artifact |
| Component deploy | Existing safe order, failure blocks later publication, exact component markers |
| Pages transition | Same artifact during observation; zero Pages publishers after retirement |
| Private canary | Branch protection rejects missing/foreign checks and accepts complete exact-head evidence |

## Tasks

- [ ] Inventory every workflow trigger, caller, permission, environment, secret/variable dependency, runner OS, artifact, cache, and deployment writer.
- [ ] Add contract tests that forbid new PR/master-push entrypoints and preserve stable required contexts.
- [ ] Convert production publication to a first-attempt, allowlisted-owner, exact-SHA dispatch with fail-closed workflow and cloud-provider identity checks while preserving protected-environment branch/secret scoping, safe component ordering, and no-op releases.
- [ ] Move every production `id-token: write` job into a reusable controller invoked by full SHA; require exact `job_workflow_ref` and `job_workflow_sha` in the cloud provider and test denial of an unlisted controller SHA.
- [ ] Rehearse the independently authorized controller-SHA rotation sequence, including dual-value canary, authoritative re-reads, bounded old-value removal, and recovery.
- [ ] Prove the selected private plan's environment capabilities; treat required reviewer approval as optional defense in depth and never as a GitHub Pro dependency.
- [ ] Emit a deployment receipt from `deploy-prod` and make post-deploy smoke consume and verify its target SHA, run identity, attempt, and manifest digest.
- [ ] Add artifact-manifest creation and independent trusted verification where current provenance is incomplete.
- [ ] Pin any remaining mutable action references and remove unnecessary token permissions.
- [ ] Preserve and test the untrusted-builder/trusted-deployer preview boundary for private PRs.
- [ ] Add the bounded dual-publish observation mode using the identical staged site artifact.
- [ ] Add Pages-retirement tests that fail on Pages actions, Pages permissions, CNAME publication, or Pages environments after the retirement flag.
- [ ] Exercise a disposable private-repository PR, preview, no-op release, failed release, and exact-SHA manual release before production cutover.

## Rollback

CI changes roll back by reverting to the last exact head that remains compatible with the current repository visibility and credential location. A workflow that depends on a public-only environment cannot be restored after privacy as an emergency shortcut. Pages publication can be restored only during the explicit DNS observation window and only from the accepted exact artifact; after Pages retirement, application rollback uses a previous Firebase Hosting release.

## Public sources

- [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
- [OpenID Connect with reusable workflows](https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-hardening-your-deployments/using-openid-connect-with-reusable-workflows)
- [GitHub OIDC token claims](https://docs.github.com/en/actions/reference/security/oidc)
- [GitHub Actions artifacts](https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts)
