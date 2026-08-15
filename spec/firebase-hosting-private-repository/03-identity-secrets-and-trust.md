# Identity, Secrets, and Trust

Status: Proposed

Depends on: Specifications [1](./01-target-state-and-public-boundaries.md) and [2](./02-ci-and-deployment-architecture.md)

## Objective

Ensure every GitHub, Firebase, Google Cloud, mobile, smoke, recovery, and PaulBot capability remains available after privacy through keyless, least-privilege, claim-bound identities without publishing operational details.

## Requirements

1. No service-account JSON key, private key, long-lived provider token, signing certificate, provisioning profile, or recovery secret may be committed, staged into a site artifact, uploaded as general CI evidence, or copied into this public specification.
2. GitHub-to-Google production and preview authentication uses workload identity federation or an equivalent short-lived keyless mechanism. Trust conditions bind the exact repository, intended workflow/ref/event, and approved visibility state.
3. A change from public to private must not accidentally fail a trust condition that asserts repository visibility, fork status, subject, audience, branch, workflow identity, or environment. Every relevant claim is inventoried and tested before cutover.
4. Production, preview, smoke, recovery, and mobile release use distinct roles where their authority differs. Read-only validation cannot inherit deployment or administrative permissions.
5. Nonsecret configuration lives in repository variables or versioned configuration. Secrets remain in the narrowest supported secret store. Environment-scoped material stays environment-scoped on the recommended plan.
6. A Free-plan fallback must migrate every environment dependency before privacy and document the lost approval/isolation semantics. Ignored or unavailable environment secrets are a hard failure, not a reason to broaden repository secrets silently.
7. Repository Actions credentials use the default token only with explicit minimal permissions. Cross-repository or host automation uses a repository-scoped GitHub App installation or fine-grained equivalent, never an unbounded classic token.
8. PaulBot's credential cannot change visibility, billing, DNS, GitHub plans, repository secrets, environments, Actions policies, branch protection, or production cloud resources.
9. The production deployment identity is inaccessible to PaulBot and to code from pull requests. Manual dispatch authority and cloud deploy authority remain separate controls.
10. Authenticated production smoke credentials are synthetic, least-privilege, isolated from human accounts, and stored only in the intended protected secret boundary. Workflow artifacts and logs must redact their inputs and returned private data.
11. Mobile signing and release identities must be tested independently because private visibility can change environment and artifact access even though the hosting migration does not release a new native binary.
12. Full-history scanning covers Git objects, workflow logs/artifacts still retained, release assets, generated bundles, documentation, and configuration. Any live finding is rotated before privacy.
13. Credential rotation is rehearsed before cutover. Revocation happens only after every replacement path passes a canary and rollback no longer depends on the old credential.
14. Exact identities, issuer resources, attribute conditions, secret names, project numbers, provider IDs, app installation IDs, and rotation commands live only in the private operator record.

## Design

### Trust inventory

Create a matrix whose rows are workflow capabilities and whose columns are trigger, caller, GitHub permissions, secret source, OIDC subject/audience, cloud principal, cloud permissions, environment, artifacts read/written, and revocation owner. The public completion evidence lists only capability names and pass/fail state; the private record contains exact values.

### Keyless deployment

The trusted job requests a short-lived GitHub OIDC token only after exact-head and artifact verification. The cloud provider accepts tokens from the exact repository/workflow/ref contract and grants a narrow deploy role. Production and preview must not share a principal if that would let a preview path reach production resources.

### Secret location

Environment secrets remain appropriate on GitHub Pro where environment scoping is available. Repository variables hold public identifiers and flags, not secrets. Provider secret managers hold runtime secrets consumed by Functions or backend services. Moving a value between stores requires a consumer inventory and a redaction test; copying it everywhere for convenience is prohibited.

### Rotation and recovery

Every credential class has a dual-validity migration where the provider permits it: provision replacement, canary, switch consumers, observe, then revoke old. For single-active credentials, schedule a bounded freeze and verified rollback. An ambiguous provider response triggers an authoritative read before retry or revocation.

## Verification matrix

| Capability | Canary before privacy | Canary after privacy |
|---|---|---|
| PR checks | Read source and report checks with minimal token | Same on a private head; no secret on untrusted code |
| Firebase preview | Verify artifact and issue short-lived preview identity | Deploy and expire a private PR preview |
| Production deploy | Authenticate and dry-run/read target state | Owner-dispatched exact-SHA no-op or approved release |
| Post-deploy smoke | Read synthetic secret and redact output | Validate canonical Firebase origin |
| Recovery health | Read only required recovery metadata | Scheduled/manual private run succeeds |
| Mobile release | Validate signing-secret/environment availability without upload | Approved dry-run or nonpublishing archive step |
| PaulBot | Authenticated read/write of test branch and exact-head status | Same with no production or settings authority |

## Tasks

- [ ] Build the private trust inventory for every workflow and external automation capability.
- [ ] Inspect current OIDC claims and cloud conditions for visibility, subject, repository, ref, workflow, audience, and environment assumptions.
- [ ] Split any shared principal whose permissions cross preview, production, smoke, recovery, mobile, or PaulBot boundaries.
- [ ] Move nonsecret values to variables and keep secrets in the narrowest supported environment/provider store.
- [ ] Remove any service-account key fallback and add tests that reject key-shaped secrets and credential files.
- [ ] Add log, artifact, workflow-summary, PR-comment, and notification redaction tests.
- [ ] Run full-history and retained-artifact secret scans; rotate every valid finding.
- [ ] Rehearse credential rotation and record sanitized evidence plus exact private rollback instructions.
- [ ] Execute the complete pre- and post-privacy canary matrix.

## Failure behavior

Missing, ignored, unreadable, expired, or ambiguously rotated credentials fail closed before an external mutation. A workflow may report a typed credential-unavailable result only when that capability is genuinely optional; production, rules, recovery, and required-check credentials are not optional. Operators must not paste secret values into dispatch inputs, issue comments, PR comments, Actions logs, or the public specification to diagnose a failure.

## Public sources

- [GitHub OIDC security hardening](https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [GitHub Actions secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)
- [Google Cloud workload identity federation for deployment pipelines](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
