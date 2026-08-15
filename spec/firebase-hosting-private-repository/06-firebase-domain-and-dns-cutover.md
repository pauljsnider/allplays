# Firebase Domain and DNS Cutover

Status: Proposed

Depends on: Specifications [1](./01-target-state-and-public-boundaries.md), [2](./02-ci-and-deployment-architecture.md), [3](./03-identity-secrets-and-trust.md), [4](./04-actions-cost-and-retention.md), and [5](./05-paulbot-private-repository-operation.md)

## Objective

Move the apex and `www` traffic from GitHub Pages to Firebase Hosting with pre-provisioned ownership, exact-SHA parity, bounded DNS uncertainty, complete product validation, and an explicit observation rollback window.

## Requirements

1. Use Firebase Hosting's Advanced Setup so domain ownership and migration prerequisites can be established while GitHub Pages continues serving production.
2. Add both the apex and `www` to the intended Firebase Hosting site. The apex serves the application; `www` returns a permanent canonical redirect to the apex.
3. The operator copies only the exact DNS ownership and routing records currently issued by the Firebase console/API into the private operator record. Example or previously observed provider values must never be treated as authoritative.
4. Before any DNS edit, export the complete authoritative zone subset for the apex, `www`, ownership verification, CAA, email-related neighboring records, current TTLs, and provider-specific alias behavior. Hash and timestamp the export privately.
5. Lower only the relevant routing TTLs to the approved cutover value, then wait at least the previous maximum TTL before changing targets. Do not disturb MX, SPF, DKIM, DMARC, or unrelated verification records.
6. Confirm CAA permits the certificate authorities required by Firebase without broadening it unnecessarily. Firebase must report valid ownership and a cutover-ready domain state before routing changes.
7. Stage one immutable site artifact from an exact accepted SHA and publish the identical file inventory to Firebase and Pages. Compare content hashes for all deployable static assets, not only the home page.
8. Parity validation covers routes, clean URL/SPA behavior, 404 behavior, redirects, MIME types, compression, cache control, CSP and security headers, runtime config, well-known files, assets, service workers, and deep links.
9. Auth validation covers popup, popup-to-redirect fallback, redirect completion, email sign-in, verification handoff, reset flow, invited/deep-linked `next` destinations, authorized domains, OAuth redirect origins, and the configured `authDomain` behavior.
10. App Check remains at its current enforcement state. The migration may add required allowed origins or monitoring, but enforcement is a separate change with separate rollout evidence.
11. Enter a change freeze before the final same-SHA deployment. PaulBot is drained to `private-cutover`, normal merges stop, and the DNS operator confirms access to Firebase, DNS, GitHub, and rollback evidence.
12. Change apex and `www` routing in the provider-supported order that avoids a mixed invalid state. After each write, re-read authoritative DNS before assuming it committed.
13. Verify resolution from the authoritative nameserver and at least two independent public resolvers, then verify TLS/SAN, redirect, security headers, canonical content, authenticated smoke, public smoke, and representative deep links from at least two network paths.
14. Mixed DNS during propagation is expected. Both hosts must serve the accepted exact SHA for the whole propagation and rollback interval.
15. Keep Pages deployable as a rollback host until the longest relevant TTL has elapsed after successful cutover plus a 24-hour stable observation window. Continue deploying only the same accepted production artifact if an emergency exact-SHA correction is approved.
16. Monitoring distinguishes Firebase default-domain health, custom-domain DNS/TLS health, product/auth health, and stale Pages responses. A passing default domain cannot prove the custom domain is healthy.

## Design

### Domain pre-provisioning

Advanced Setup separates proof of control from traffic routing. Publish only Firebase's current ownership challenge while Pages remains live, allow certificate preparation where supported, and wait for a provider status that explicitly permits migration. An expired challenge or ambiguous status is regenerated and re-read; it is not retried by replaying old values.

### Exact-SHA parity

The release manifest is the source of truth. Compare the candidate Firebase default domain and current Pages custom domain against a bounded route/file inventory. Dynamic Firebase reserved namespaces may differ by design, but deployable application content, security behavior, and user flows must match the acceptance matrix.

### DNS execution

The private runbook contains the exact pre-change and intended post-change record sets, commands/UI path, TTL clock, operator, witness, and authoritative re-read. The public plan intentionally omits literal A, AAAA, CNAME, TXT, CAA, provider account, and zone identifiers because they are time-sensitive operational state.

### Observation window

Monitor both the custom domain and Firebase default domain continuously, sample public resolver answers, and watch auth/error telemetry. Freeze unrelated production releases until the first stable checkpoint. Pages remains content-equivalent but receives no new independent build.

## Verification matrix

| Surface | Before DNS | After authoritative change | After public propagation |
|---|---|---|---|
| Apex DNS | Pages target exported | Firebase target authoritative | Independent resolvers converge |
| `www` DNS | Current target exported | Firebase-supported target authoritative | Permanent apex redirect works |
| TLS | Firebase readiness checked | Correct certificate begins serving | Valid chain/SAN on two networks |
| Static content | Firebase/Pages hash parity | Accepted manifest on both | Canonical domain matches manifest |
| Headers/cache | Candidate parity | No unsafe regression | Browser and command-line checks pass |
| Auth/deep links | Default-domain candidate passes | Custom-origin callback passes | Complete signed-in smoke passes |
| Monitoring | Baselines captured | DNS/TLS alerts active | Stable through observation window |

## Tasks

- [ ] Add apex and `www` through Firebase Advanced Setup and store exact issued actions privately.
- [ ] Export and validate the authoritative DNS/CAA/TTL baseline without modifying unrelated records.
- [ ] Lower relevant TTLs and wait the previous maximum TTL.
- [ ] Build the exact-SHA route, file-hash, header, redirect, auth, and deep-link parity harness.
- [ ] Validate Firebase default-domain content and custom-domain readiness.
- [ ] Rehearse cutover and rollback using symbolic public steps plus exact private values.
- [ ] Freeze changes, drain PaulBot, deploy one exact SHA to both hosts, and capture release evidence.
- [ ] Apply DNS changes with authoritative re-reads after every mutation.
- [ ] Run resolver, TLS, redirect, public smoke, authenticated smoke, and two-network validation.
- [ ] Observe through the maximum TTL plus 24 stable hours before authorizing Pages retirement.

## Rollback

Before DNS changes, abort without user impact. During propagation or the bounded observation window, restore the exact exported Pages routing records, confirm the authoritative write, and keep both hosts on the accepted SHA while caches expire. Never invent rollback records from documentation or memory. After Pages retirement, DNS rollback to Pages is prohibited; use Firebase release rollback or an approved forward fix.

## Public sources

- [Connect a Firebase Hosting custom domain](https://firebase.google.com/docs/hosting/custom-domain)
- [Configure Firebase Hosting redirects, rewrites, and headers](https://firebase.google.com/docs/hosting/full-config)
- [Firebase Auth redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices)
- [GitHub Pages custom-domain security](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
