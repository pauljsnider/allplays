# Signed-channel and workload-ingress expiry boundaries

The subsequent [backend executor review](BACKEND_EXECUTOR_REVIEW.md) documents
the isolated real-domain executor that enforces these supplied guards at fetch.

This fixes two independently reproduced pre-activation races in the unmounted
channel. No production route, access grant, credential, rule or data changes.

## Signed command authorization

Previously `checkCurrent` checked the signed deadline and pinned key before
awaiting `authorizeActor`. An authorization result arriving after expiry or key
removal could still invoke the executor. A later denial could not undo a write.
Six regressions failed on the preceding head: expiry, key removal and key
replacement during either the initial or post-reservation authorization check.

The channel now checks the deadline and exact pinned key again after the last
awaited authorization. It also checks synchronously after awaited caller
boundaries and immediately before executor invocation. The executor receives:

- `assertCurrent()`: reverify current user token, session and manager access;
  returns the synchronous guard after all awaited checks succeed.
- `assertDispatchReady()`: synchronously reject an expired signed command or a
  removed/replaced pinned signing key. The eventual executor must call this at
  its final fetch boundary after its own awaited work.

Tests compose the provided guard with the actual `createDirectCommandStore`
REST adapter. Expiring the command or removing its key in a microtask after
the async hook produces zero business `:commit` calls. A post-reservation
rejection retains the reservation; neither restoration of the key nor a retry
turns it into permission to execute again. Unknown executor outcomes remain
unverified and are not automatically replayed.

The signed channel still uses a synthetic executor in its general protocol
tests. The real signed-channel-to-domain-engine composition remains an
activation prerequisite; a trusted executor must not omit these guard calls.
No pre-dispatch check can undo a business request that was already sent.

## Workload ingress

Previously the verified workload token and principal allowlist were checked
before rate limiting and body streaming. Four regressions demonstrated that
expiry or allowlist removal during either wait still invoked the channel.

The handler now snapshots the verified principal/audience/expiry, rechecks them
after rate limiting, and checks expiry and current allowlist membership again
after parsing the body, immediately before invoking the channel. Signed-command
and user/session verification remain separate mandatory channel checks.

Body reads retain the 49,152-byte limit and now have a 10-second default deadline.
The host may configure 1–30,000 milliseconds. Both elapsed-time checks and a wall
timer enforce the bound; a stalled stream is destroyed and never reaches the
channel. An HTTP peer may observe a closed connection instead of a 408 when its
request stream is destroyed. Host-wide connection, SDK and rate-limiter request
deadlines remain separate production requirements.

Validation: **284 backend tests**, including **56 channel/HTTP tests**, and
**398 MCP unit/protocol tests** pass. Sixteen new tests cover delayed
authorization, key removal/replacement, final REST guards, delayed rate/body
workload checks, stalled streams and body-deadline bounds. The 65 emulator tests
passed in the preceding checkpoint; these channel-only changes do not alter
that composition and did not rerun those emulator suites.
