# Hosting cutover and rollback runbook

This runbook gates a future move of `allplays.ai` and `www.allplays.ai` from
GitHub Pages to the Firebase Hosting candidate at
`https://game-flow-c6311.web.app`. It does not authorize or execute that change.

The rollback target is the last known-good GitHub Pages deployment serving the
canonical domains immediately before cutover. The GitHub Pages origin is
`pauljsnider.github.io`. The exact pre-cutover DNS provider export is the
rollback source of truth; do not reconstruct records during an incident.

## Change record

Create one evidence location before validation and record:

- cutover decision owner, DNS operator, rollback owner, and start time in UTC;
- DNS provider, authoritative nameservers, and provider export of every record
  for `allplays.ai` and `www.allplays.ai`, including type, name, value, TTL,
  priority, and proxy mode where applicable;
- maximum pre-cutover TTL and the time each changed record was last observed
  with its rollback value;
- approved Firebase Hosting DNS targets from the Firebase console;
- last known-good GitHub Pages commit and workflow/deployment URL;
- Firebase Hosting candidate commit and workflow/deployment URL;
- tested origin, command, timestamp, exit status, and complete redacted output
  for every gate in this runbook.

At the time this runbook was written, public DNS returned the GitHub Pages apex
addresses `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and
`185.199.111.153`, with `www CNAME pauljsnider.github.io`. These are context,
not permission to skip the provider export and second-operator verification.
GitHub can change its published targets.

Do not capture passwords, cookies, session tokens, App Check debug tokens, or
user data in the evidence.

## Pre-cutover gate

All items are mandatory. A failed, skipped, stale, or missing-credential result
is a no-go.

1. Confirm in Firebase Console that every Firebase API remains **Unenforced** in
   App Check. Keep that state throughout candidate validation, DNS propagation,
   and cutover observation. Do not use a production debug token, client bypass,
   or enforcement change to make validation pass.
2. From the exact candidate deployment commit, run the public route, scoreboard,
   runtime-config, and configured-header smoke:

   ```bash
   npm run smoke:candidate-host -- https://game-flow-c6311.web.app
   ```

3. Run the independent response-header policy check:

   ```bash
   node scripts/verify-response-headers.mjs https://game-flow-c6311.web.app
   ```

4. Run authenticated candidate-host smoke with the protected production-smoke
   account. Supply secrets through the approved secret store, never the command
   line or evidence log:

   ```bash
   CANDIDATE_HOST_URL=https://game-flow-c6311.web.app \
     SMOKE_AUTH_EMAIL="$SMOKE_AUTH_EMAIL" \
     SMOKE_AUTH_PASSWORD="$SMOKE_AUTH_PASSWORD" \
     npx playwright test tests/smoke/candidate-host-auth.spec.js \
       --config=playwright.smoke.config.js --reporter=line
   ```

5. Retain successful public and authenticated results with the tested origin,
   timestamp, commit SHA, deployment or workflow URL, exit status, and redacted
   output. Evidence from a different deployment is stale.
6. Complete the candidate-origin TLS check and the pre-change DNS snapshot in
   the next section. Have a second operator compare the provider export,
   rollback target, candidate targets, and TTLs before the decision owner
   records go/no-go.

## DNS and TLS validation

### Before changing DNS

Query the authoritative nameservers and at least two independent public
recursive resolvers. Check A, AAAA, and CNAME records even when an empty result
is expected, so stale IPv6 or aliases are not missed.

```bash
dig +short NS allplays.ai
dig +noall +answer allplays.ai A allplays.ai AAAA allplays.ai CNAME
dig +noall +answer www.allplays.ai A www.allplays.ai AAAA www.allplays.ai CNAME
dig @1.1.1.1 +noall +answer allplays.ai A allplays.ai AAAA allplays.ai CNAME
dig @1.1.1.1 +noall +answer www.allplays.ai A www.allplays.ai AAAA www.allplays.ai CNAME
dig @8.8.8.8 +noall +answer allplays.ai A allplays.ai AAAA allplays.ai CNAME
dig @8.8.8.8 +noall +answer www.allplays.ai A www.allplays.ai AAAA www.allplays.ai CNAME
```

Repeat the A, AAAA, and CNAME queries against each nameserver returned by the NS
query, using `dig @<authoritative-nameserver> ...`. Save the answers and TTLs.
Every observed candidate value must exactly match the approved Firebase Hosting
targets recorded in the change record.

Validate the candidate origin with normal trust checks enabled:

```bash
curl --fail --silent --show-error --location --output /dev/null \
  https://game-flow-c6311.web.app/
openssl s_client -connect game-flow-c6311.web.app:443 \
  -servername game-flow-c6311.web.app -verify_return_error \
  -verify_hostname game-flow-c6311.web.app </dev/null
openssl s_client -connect game-flow-c6311.web.app:443 \
  -servername game-flow-c6311.web.app </dev/null 2>/dev/null |
  openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

Require a chain to a trusted root, `subjectAltName` coverage for the requested
hostname, a current `notBefore`/`notAfter` interval, and no intermittent
handshake failure. Do not use `curl -k`, `--insecure`, or an OpenSSL verification
bypass.

### During and after propagation

1. Repeat the authoritative and public-resolver queries for both canonical
   hosts. Record every answer, not only the expected one.
2. Continue until the authoritative nameservers and both `1.1.1.1` and
   `8.8.8.8` return only the approved Firebase Hosting targets, and no stale
   GitHub Pages target remains after the recorded pre-cutover TTL has elapsed.
3. Validate HTTPS for both canonical hosts using the same `curl` and
   `openssl s_client` pattern, substituting `allplays.ai` and
   `www.allplays.ai`. Test from two independent networks or external probes.
4. Reject a certificate that is pending, expired, not yet valid, untrusted,
   missing either hostname from its SANs, or reliable only from one probe.
   Reject redirects whose final origin is not the requested canonical origin.
5. Run the pre-cutover public, header, and authenticated commands again with
   `https://allplays.ai` as the supplied origin. Repeat the public and TLS checks
   for `https://www.allplays.ai` and confirm its intended canonical redirect or
   same-origin behavior.
6. Confirm the scoreboard, `/.well-known/allplays-runtime-config.json`, public
   pages, login, and protected landing page all remain usable.

Do not declare cutover complete while DNS answers are mixed, TLS is incomplete,
any smoke result fails, or a material cutover-related authentication, HTTP,
Firebase, or CSP error-rate increase remains open.

## Rollback

Rollback target: the last known-good GitHub Pages deployment at
`pauljsnider.github.io` and exact pre-cutover record set captured in the change
record.

Trigger immediate rollback for canonical TLS failure, unexpected-origin
redirects, DNS misrouting beyond the approved propagation window, failed public
or authenticated smoke, missing or incorrect required response headers,
unavailable runtime config, broken scoreboard embedding, or a material
cutover-related production error-rate increase.

1. Declare rollback. Name the incident owner and freeze further DNS, hosting,
   App Check, and CSP changes. Keep the Firebase candidate deployment available
   for diagnosis.
2. Restore the exact pre-cutover record set from the verified DNS provider
   export. Restore every saved A, AAAA, and CNAME value and TTL for
   `allplays.ai` and `www.allplays.ai`; remove only candidate-only records that
   conflict with that saved set. Do not substitute remembered or current
   example values.
3. Verify authoritative DNS returns only the restored GitHub Pages values for
   both canonical hosts. Record timestamps and full answers.
4. Verify at least two public recursive resolvers return the restored values.
   Continue checking through the maximum recorded TTL; mixed answers mean
   rollback is still in progress.
5. Validate TLS for `allplays.ai` and `www.allplays.ai` from two independent
   probes without bypasses. Confirm trusted chains, hostname/SAN coverage,
   validity dates, and expected-origin behavior.
6. Run the public and authenticated smoke checks against the restored canonical
   host. Use the production Playwright smoke for public routes, scoreboard, app
   boot, and runtime config, and use
   `tests/smoke/candidate-host-auth.spec.js` with
   `CANDIDATE_HOST_URL=https://allplays.ai` for authenticated recovery.
7. Confirm the temporary meta CSP bridge remains present and effective in the
   GitHub Pages HTML. Preserve browser or page-source evidence without user
   data.
8. Close rollback only after the rollback owner records the final DNS export,
   resolver and TLS evidence, smoke workflow URLs and results, timestamps,
   incident disposition, and follow-up owner.

Rollback is complete only when DNS, TLS, public smoke, authenticated smoke,
scoreboard behavior, runtime configuration, and the GitHub Pages meta CSP bridge
all pass against the rollback target. App Check stays **Unenforced**.

## Meta CSP bridge removal gate

Removing the temporary meta CSP bridge is a separate reviewed change. DNS
propagation alone is insufficient. Retain the bridge until the change record
contains all of this evidence:

- authoritative nameservers and at least two public resolvers direct both
  canonical hosts only to Firebase Hosting for one full recorded pre-cutover
  TTL and a minimum 24-hour observation window;
- valid TLS for both canonical hosts from two independent networks or probes,
  including trusted chain, hostname/SAN, `notBefore`, and `notAfter` evidence;
- two consecutive successful public, response-header, and authenticated smoke
  runs against the canonical origin after DNS convergence, including one
  scheduled or independently rerun check;
- response captures proving `Content-Security-Policy` and the other required
  policies are delivered as an HTTP response header on every checked page,
  widget, runtime-config response, and application asset;
- browser evidence that no supported route depends on the meta policy and that
  there are no material CSP violations;
- no open cutover-related production regression and no material increase in
  authentication, HTTP, Firebase, or CSP error rates during the observation
  window;
- either GitHub Pages is no longer a serving or rollback path, or an equivalent
  CSP control remains available on every GitHub Pages artifact that can receive
  traffic;
- retained timestamp, tested origin, commit and deployment identifiers, command
  outputs, workflow URLs, monitoring links, release-owner sign-off, security
  reviewer sign-off, explicit approval to remove the bridge, and a rollback
  plan for the removal change.

If any evidence is missing or stale, keep the meta CSP bridge.
