# Order, Validation, Monitoring, and Rollback

Status: Proposed

Depends on: Specifications [1](./01-target-state-and-public-boundaries.md), [2](./02-ci-and-deployment-architecture.md), [3](./03-identity-secrets-and-trust.md), [4](./04-actions-cost-and-retention.md), [5](./05-paulbot-private-repository-operation.md), [6](./06-firebase-domain-and-dns-cutover.md), and [7](./07-pages-retirement-and-repository-privacy.md)

## Objective

Define the authoritative end-to-end execution sequence, evidence gates, monitoring, stop conditions, and phase-specific rollback behavior for the migration.

## Authoritative order of operations

### 1. Establish a clean, current baseline

- Bind the implementation plan to the current `origin/master` base SHA and a new implementation head.
- Confirm the worktree is clean and no stale merged branch is reused.
- Re-inventory workflows, Firebase configuration, Pages, DNS, repository settings, open work, security tooling, PaulBot, Actions usage, and vendor documentation.
- Create and review the private operator record.

Exit gate: exact baseline and complete private exports are accepted. Rollback: none; no provider state changed.

### 2. Select the GitHub private plan

- Prove required private branch protection, required checks, environments, secrets/variables, OIDC, collaborators, and Apps in a disposable private test.
- Activate the selected plan before production relies on its features.

Exit gate: recommended GitHub Pro capabilities pass. Rollback: cancel the plan change and stop; repository remains public.

### 3. Make CI and release control private-compatible

- Preserve stable PR entrypoints and contexts.
- Convert production to owner-authorized exact-SHA manual dispatch.
- Preserve trusted preview and artifact boundaries.
- Add Pages observation/retirement states without changing live hosting.

Exit gate: current public PRs, preview, manual no-op release, component ordering, and post-deploy evidence pass. Rollback: revert CI head while public.

### 4. Make identities and security controls private-compatible

- Complete the trust inventory, claim audit, keyless role separation, secret-store placement, full-history scan, credential rotation rehearsal, and private test canaries.
- Land or explicitly disposition related passive repository-security guardrails without taking over externally claimed files.

Exit gate: no unresolved live secret and every required capability has a private-compatible identity. Rollback: switch consumers to the last proven credential while public.

### 5. Optimize and accept cost

- Implement job attribution, duplicate/no-op suppression, cancellation, impact gating, macOS gating, safe job consolidation, retention limits, and budget states.
- Observe at least seven representative days.

Exit gate: forecast total incremental cost is at or below $25/month and burst tests activate controls safely. Rollback: revert individual optimizations that break validation; do not proceed at the approximately $490/month baseline.

### 6. Prepare PaulBot

- Narrow repository App permissions, add fail-closed private checks, remove any indirect deployment path, test durable operating states, audit notifications, and rehearse drain/resume.

Exit gate: public rehearsal and disposable-private canaries pass; PaulBot can be paused durably. Rollback: retain existing public mode or disable bot.

### 7. Pre-provision Firebase custom domains

- Use Advanced Setup for apex and `www`, publish current ownership proof, validate CAA/certificate readiness, and preserve Pages routing.

Exit gate: Firebase reports cutover-ready ownership/domain state while Pages remains healthy. Rollback: remove only newly added verification state after authoritative review.

### 8. Qualify one exact release candidate

- Stage one exact-SHA artifact, deploy it to Firebase and Pages, compare file hashes, routes, headers, redirects, auth, deep links, and public/private smoke.

Exit gate: complete parity and production-safety evidence for the exact SHA. Rollback: redeploy the previous accepted exact release to both hosts.

### 9. Lower TTLs and rehearse

- Export exact DNS again, lower only relevant TTLs, wait the previous maximum TTL, run a timed no-write rehearsal, freeze changes, and move PaulBot to `private-cutover`.

Exit gate: operator access, witness, timing, rollback values, monitoring, and zero active mutations are proven. Rollback: restore prior TTLs or allow them to expire; no routing changed.

### 10. Cut DNS to Firebase

- Apply the exact approved apex and `www` record changes.
- Re-read authoritative DNS after every write.
- Verify independent resolvers, TLS, redirects, exact content, headers, auth, deep links, and two-network smoke.

Exit gate: canonical Firebase origin passes and monitoring is stable. Rollback: during this phase only, restore the exact exported Pages records and verify convergence.

### 11. Observe with Pages as bounded rollback

- Keep both hosts on the accepted SHA.
- Monitor DNS/TLS, Firebase default/custom domains, auth, error rates, public routes, and stale Pages responses through the maximum TTL plus 24 stable hours.

Exit gate: no unresolved critical signal and explicit approval to retire Pages. Rollback: restore exact Pages DNS within the window.

### 12. Retire GitHub Pages

- Confirm no DNS response targets Pages.
- Unpublish Pages, remove custom-domain binding/artifact, remove Pages writers/permissions/environments, and re-read final state.

Exit gate: no Pages publication or takeover path remains. Rollback: none to Pages; Firebase release rollback becomes authoritative.

### 13. Make the repository private

- Capture the final public snapshot, confirm the exact repository and selected plan, change visibility through an owner action, and re-read state.
- Keep PaulBot and normal merges frozen.

Exit gate: repository is private, anonymous access fails, and expected owner/collaborator access remains. Rollback: keep private and repair; do not re-publicize.

### 14. Execute private canaries and staged resume

- Verify protection/check identities, PR CI, preview, PaulBot, owner production no-op/release, smoke, recovery, mobile secrets, security tooling, cost ledger, and notifications.
- Resume human merges, releases, PaulBot closeout, and PaulBot discovery in that order.

Exit gate: every required canary passes and no cost/protection/security alert is open. Rollback: freeze the failed lane, keep repository private, roll Firebase release if product health requires it.

### 15. Harden and close out

- At 24 hours, validate product/auth/monitoring and remove temporary dual-host controls.
- At seven days, reconcile cost and access, rotate transitional credentials, and tighten least privilege.
- After one billing cycle, reconcile forecast to actual invoice and close or adjust budgets.
- Archive the private operator record according to the accepted retention policy and publish only a sanitized completion summary.

Exit gate: exact production evidence, private repository state, PaulBot health, and billing reconciliation are complete.

## End-to-end verification matrix

| Domain | Required evidence before DNS | Required evidence before privacy | Required evidence after privacy |
|---|---|---|---|
| Source/release | Exact manifest and validation | Firebase release marker and post-deploy smoke | Owner-dispatched private exact-SHA evidence |
| CI | Public exact-head checks | Private test-repository proof | Real private PR stable contexts |
| Hosting | Firebase default-domain parity | Custom-domain stable observation | Firebase rollback capability |
| DNS/TLS | Export, TTL wait, readiness | No response targets Pages | Ongoing resolver/TLS monitor |
| Auth/product | Candidate auth/deep-link matrix | Canonical two-network smoke | Authenticated private release smoke |
| Repository | Plan/capability proof | Pages fully retired | Private access and protections |
| PaulBot | Public rehearsal | Drained `private-cutover` | Staged private canary and bounded resume |
| Cost | Seven-day forecast at or below ceiling | Budget alerts active | Seven-day and billing-cycle reconciliation |
| Security | Full-history scan and replacements | Public-only feature disposition | Private security tooling active |

## Monitoring and alerts

1. DNS monitors query the authoritative nameserver and multiple public resolvers for apex and `www` and distinguish propagation from configuration drift.
2. TLS monitors validate hostname, chain, expiry, and redirect endpoint independently of content health.
3. Hosting monitors test Firebase default and custom domains, accepted release identity, key routes, headers, assets, and redirect behavior.
4. Product monitors cover unauthenticated boot plus synthetic authenticated sign-in/deep-link flows without logging private user data.
5. Release monitors bind component markers and post-deploy smoke to the exact workflow run and SHA.
6. GitHub monitors verify visibility, default branch, branch protection, required checks and producers, environment availability, App installation, Actions policy, and Pages disabled state.
7. PaulBot monitors verify durable operating state, credential health, active leases/mutations, merge refusals, exact-head gate freshness, and cost mode.
8. Cost monitors attribute daily runner/storage use, project month-end spend, and alert before the accepted ceiling.
9. Every alert has an owner, severity, safe first response, evidence location, and rule for returning to normal. Private routing details stay out of public docs.

## Rollback matrix

| Failure phase | Safe response | Prohibited shortcut |
|---|---|---|
| Before provider changes | Stop and revise plan | Proceed on assumptions |
| CI/identity while public | Revert to last public-compatible exact head | Broaden secrets or permissions |
| Firebase candidate | Redeploy previous candidate/production SHA | Change DNS to diagnose |
| DNS propagation/observation | Restore exact exported Pages DNS | Invent or copy stale records |
| After Pages retirement | Roll Firebase to known-good release | Recreate Pages ad hoc |
| Repository privacy | Keep private; repair plan/access/integration | Make public to restore a bot or workflow |
| PaulBot private failure | Enter `private-cutover`; rotate if needed | Grant production/settings authority |
| Cost overrun | Enter `budget-guard` or `release-only` | Skip required security/recovery checks silently |
| Ambiguous external response | Authoritative re-read before retry | Assume success or failure |

## Stop conditions

Stop the migration immediately when any of the following is true:

- The current repository, domain, Firebase site, or target SHA does not match the private operator record.
- An authoritative read is partial, unavailable, or conflicts with the intended state.
- The selected plan does not provide required private branch or environment capabilities.
- A live secret remains in public history or a replacement identity broadens authority.
- The cost forecast exceeds the accepted ceiling or lacks a complete runner class.
- PaulBot cannot drain to zero mutations or its restrictive state does not survive restart.
- Firebase ownership, certificate, exact-SHA parity, auth, or custom-domain readiness is incomplete.
- DNS rollback values are missing, unverified, or older than the current authoritative state.
- A required CI, protection, security, smoke, recovery, or monitoring signal is missing or produced by an unexpected identity.

## Tasks

- [ ] Convert each numbered phase into a private runbook checklist with exact values, operator, witness, timestamps, and evidence links.
- [ ] Add machine-checkable preflight and postflight commands that output sanitized pass/fail summaries.
- [ ] Rehearse every reversible phase and at least one injected ambiguous provider response.
- [ ] Exercise DNS, Firebase release, private-integration, PaulBot, and budget rollback drills.
- [ ] Obtain explicit approval at the cost, DNS, Pages-retirement, and repository-privacy gates.
- [ ] Complete 24-hour, seven-day, and billing-cycle reviews before declaring the migration closed.

## Final completion evidence

The sanitized public closeout may state only the accepted exact source SHA, Firebase custom-domain health, Pages-retired status, repository-private status, stable check names, PaulBot operating state, cost-versus-ceiling result, and completion date. Exact DNS records, provider identities, private run URLs/logs, billing exports, credentials, contacts, and recovery procedures remain in the private operator record.
