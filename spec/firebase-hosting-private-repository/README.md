# Firebase Hosting and Private Repository Specifications

Status: Proposed

This folder defines the requirements, design boundaries, order of operations, and implementation tasks for moving the public AllPlays site from GitHub Pages to Firebase Hosting and then making the GitHub repository private.

These documents are planning artifacts only. Merging them does not authorize a Firebase custom-domain change, DNS mutation, GitHub Pages retirement, GitHub plan purchase, credential change, PaulBot mode change, or repository visibility change.

## Public-documentation boundary

This folder is committed while the repository is public, and the repository's existing public history and detached public forks will remain public after a visibility change. The specifications therefore contain only public product architecture, public workflow and check names, generalized credential roles, qualitative cost-control requirements, and links to public vendor documentation.

The following values belong in a separate private operator record and must never be added to this folder:

- Tokens, private keys, secret values, recovery codes, or raw credential scopes.
- Service-account addresses, workload-identity resource strings, account or installation identifiers, and provider request payloads.
- Internal hostnames, IP addresses, SSH aliases, dashboard ports, private filesystem paths, and nonpublic URLs.
- Exact DNS rollback records, credential locations, billing exports, workload samples, cost forecasts, budget amounts and alert thresholds, raw workflow logs, private contacts, and emergency access procedures.

The public specifications use symbolic roles such as `production deploy identity`, `repository-scoped automation credential`, and `authoritative DNS export`. An operator must resolve those roles from the private record during an approved migration.

## Product and operational principles

- Keep `https://allplays.ai` public and canonical while making its source repository private.
- Serve both the apex and `www` safely, with `www` permanently redirecting to the apex.
- Never make the repository private while GitHub Pages still serves or verifies the custom domain.
- Deploy one immutable, exact-SHA site bundle to Firebase and prove parity before changing DNS.
- Preserve the existing `pr-fast`, `pr-integration`, trusted-preview, exact-SHA release, and post-deploy evidence boundaries.
- Use GitHub Pro as the recommended private-repository baseline so branch protection and private-repository environments remain available. A Free-plan variant is blocked unless every lost protection and environment dependency has an accepted replacement.
- Keep PaulBot authenticated, repository-scoped, fail-closed, cost-bounded, and unable to deploy production, edit DNS, or change repository visibility.
- Treat the existing public source history as permanently disclosed. Privacy protects future work; it does not retract old commits or public forks.
- Keep App Check enforcement outside this migration. Origin changes must not be coupled to a new App Check enforcement boundary.
- Make every consequential step observable, reversible where possible, and conditional on explicit entry and exit evidence.

## Cost gate

The migration cannot proceed until a representative private forecast, reconciled with current billing and account-wide usage, passes an explicitly owner-approved confidential cutover ceiling. Exact forecasts, usage totals, budget amounts, and alert thresholds stay in the private operator record unless publication receives separate owner approval. Specification [4](./04-actions-cost-and-retention.md) defines the public measurement and enforcement contract.

## Specification index

| # | Specification | Primary outcome | Depends on |
|---|---|---|---|
| 1 | [Target state and public boundaries](./01-target-state-and-public-boundaries.md) | Agreed destination, plan choice, scope, and public/private documentation split | Current repository and vendor capabilities |
| 2 | [CI and deployment architecture](./02-ci-and-deployment-architecture.md) | Private-compatible CI, trusted previews, and manual exact-SHA production releases | 1 |
| 3 | [Identity, secrets, and trust](./03-identity-secrets-and-trust.md) | Keyless, least-privilege authentication that survives the visibility change | 1, 2 |
| 4 | [Actions cost and retention](./04-actions-cost-and-retention.md) | Measured cost reduction, retention policy, budget controls, and cutover gate | 1–3 |
| 5 | [PaulBot private-repository operation](./05-paulbot-private-repository-operation.md) | Safe bot authentication, merge gating, cutover posture, and budget behavior | 1–4 |
| 6 | [Firebase domain and DNS cutover](./06-firebase-domain-and-dns-cutover.md) | Pre-provisioned domains, exact-SHA parity, DNS transition, and observation | 1–5 |
| 7 | [Pages retirement and repository privacy](./07-pages-retirement-and-repository-privacy.md) | Pages removal, visibility change, private canaries, and history/fork handling | 1–6 |
| 8 | [Order, validation, monitoring, and rollback](./08-order-validation-monitoring-rollback.md) | One gated execution sequence with evidence and phase-specific recovery | 1–7 |

## Current implementation boundary

At the time of this plan, GitHub Pages serves the canonical custom domain. The production workflow already builds one trusted bundle, deploys it to Firebase Hosting, and then publishes that exact release to Pages. The separate Pages workflow is manual validation only. Pull-request validation enters through `pr-fast` and `pr-integration`; Firebase previews preserve an untrusted builder and trusted deployer split; production handoff records exact-SHA release and post-deploy evidence.

The repository is public and its default branch is protected by stable CI and PaulBot check contexts. Several production, preview, recovery, smoke, and mobile workflows depend on GitHub environments. Standard GitHub-hosted Actions are currently free because the repository is public; the same activity becomes metered after privacy. These are migration inputs, not guarantees: each must be re-inventoried from the then-current default branch immediately before implementation.

## Delivery chunks

### Chunk 1: Private-compatible control plane

Implement specifications 1–4 without changing production hosting or visibility. Confirm the GitHub plan, preserve branch protection and environments, make release authority allowlisted-owner-only and exact-SHA-bound, harden identity, optimize CI, and obtain acceptance of the confidential private cost gate.

### Chunk 2: PaulBot readiness

Implement specification 5 while the repository remains public. Exercise authenticated repository access, exact-head checks, merge refusal, cost modes, pause/drain behavior, and private-link handling without granting deployment or visibility authority.

### Chunk 3: Firebase custom-domain cutover

Implement specification 6. Pre-provision Firebase ownership and certificates with Advanced Setup while Pages remains live, qualify the same exact SHA on both hosts, lower TTLs, enter the freeze, redeploy and revalidate that artifact after the freeze, change DNS, and observe Firebase as the canonical host while Pages remains the bounded rollback host.

### Chunk 4: Pages retirement and privacy

Implement specifications 7–8. Retire Pages only after the DNS observation gate, remove every Pages publisher and custom-domain binding, make the repository private, execute private canaries, and complete staged hardening and cost review.

## High-level order of operations

1. Rebase the implementation plan onto a clean, current default-branch SHA and export current public state into the private operator record.
2. Select and activate the private-repository GitHub plan before relying on its capabilities.
3. Make CI, deployments, identities, secrets, recovery workflows, and mobile release private-compatible while the repository is still public.
4. Reduce and measure Actions usage until the representative private forecast passes the confidential owner-approved cost gate.
5. Put PaulBot into a tested private-ready posture, then pause new work and drain active mutations.
6. Pre-provision Firebase custom domains, ownership, and TLS without moving production traffic.
7. Qualify one exact SHA on both hosts with content/behavior parity, separate host-specific security-policy checks, auth, deep-link, and smoke evidence.
8. Lower DNS TTLs, wait out the previous TTL, execute a rehearsal, enter the change freeze, then redeploy and revalidate the qualified artifact and receipt before DNS mutation.
9. Point DNS to Firebase, verify authoritative and public resolution plus TLS and product behavior, and observe for the defined window.
10. Retire every GitHub Pages publication and binding; verify no DNS path can return to Pages.
11. Make the repository private and execute CI, deployment, security, collaborator, and PaulBot canaries.
12. Resume automation gradually, remeasure spend, tighten least privilege, and close the private operator record with exact evidence.

Specification [8](./08-order-validation-monitoring-rollback.md) is authoritative when this summary and the detailed execution sequence differ.

## Production-safety applicability

This migration changes public routing, deployment authority, source visibility, CI enforcement, secret availability, automation access, and cost exposure. Authorization, confirmation, privacy, durability, partial failure, interrupted execution, stale-state validation, rollback evidence, and external side effects all apply. No step may infer success from an incomplete read, a timed-out provider response, or a workflow whose exact head is unknown.

## Cross-specification definition of done

The migration is complete only when:

- Firebase Hosting serves the apex domain with the accepted exact SHA, security headers, canonical redirects, and authenticated product flows.
- `www` permanently redirects to the apex and no production DNS record targets GitHub Pages.
- GitHub Pages is unpublished, its workflows and permissions are retired, and no Pages custom-domain takeover path remains.
- The repository is private, intended collaborators and integrations retain only required access, and public forks/history are documented as still public.
- Stable CI checks and server-enforced default-branch protection work on private pull requests.
- Production deployment requires a first-attempt dispatch actor from the authoritative immutable-ID owner allowlist, uses the protected `master` workflow version, and is independently restricted by cloud-provider repository/workflow/ref/event/actor claims. It fails closed on ambiguous authorization and cannot be initiated by PaulBot, another repository writer, a rerun, or an ordinary merge alone. Required environment-reviewer approval is optional defense in depth when the selected private plan supports it, not a GitHub Pro dependency.
- Post-deploy smoke consumes the deployment receipt and verifies the requested target SHA, deploy run/attempt, and manifest digest rather than inferring release identity from the dispatch ref.
- Keyless production, preview, smoke, recovery, and mobile identities pass private canaries without broadening claims or storing service-account keys.
- PaulBot can read, branch, open and update pull requests, report its exact-head gate, refuse unsafe merges, and enter `private-cutover` or `budget-guard` mode fail-closed.
- A post-privacy seven-day measurement remains at or below the accepted monthly cost forecast, with alerts and workload attribution enabled.
- The private operator record contains exact DNS, identity, billing, evidence, and rollback data; none of that sensitive material appears in this public history.

## Public sources

- [GitHub repository visibility consequences](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
- [GitHub Actions included usage](https://docs.github.com/en/billing/reference/product-usage-included)
- [GitHub Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Firebase Hosting custom domains](https://firebase.google.com/docs/hosting/custom-domain)
- [Firebase Hosting usage, quotas, and pricing](https://firebase.google.com/docs/hosting/usage-quotas-pricing)
