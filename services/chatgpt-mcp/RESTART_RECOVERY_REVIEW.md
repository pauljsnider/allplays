# Isolated restart and notification recovery

This checkpoint extends the unmounted session/signer composition with read-only
replacement-session status and a durable notification recovery runner. No public
route, production trigger, scheduled job, credential, permission or deployment
configuration is added. Existing production entry points remain unchanged.

## Replacement MCP session status

A new internal signed purpose, `schedule.recover`, accepts only a team ID and
proposal ID. It accepts no approval, preview, executable changes or write plan.
The signed channel applies its existing pinned-key, user-token, live-session,
current-team authorization, expiry and private ingress checks before looking up
the deterministic backend operation. It reauthenticates after that private read.
The recovery branch cannot reserve an attempt, call the executor, alter durable
status, or authorize notification delivery.

New private attempt records include a hash of the original account, OAuth client
and grant binding, independently of the original MCP session. A replacement
session can read that attempt only when all three still match. Historical rows
without this explicit recovery binding fail closed. Missing rows return
`not_started` without creating state. Reserved and unverified rows remain
`unverified`; recovery never promotes them from a user-writable receipt.

The current grant binding hashes the exact OAuth access token. Consequently this
supports a restarted MCP service/session using the same still-current access-token
grant. A rotated, refreshed, expired or newly consented access-token grant is not
equivalent, even for the same account/client. Cross-grant status recovery remains
a separate policy and implementation decision; no persistent grant was created.

The existing schedule status tool uses this minimal lookup when its in-memory
submission ledger is absent. The local proposal supplies routing context only;
its completed receipt cannot establish backend completion. Within the original
session, submitted operations retain the earlier exact-command status path.
`not_started` is not permission to auto-save: neither status path submits or
replays a business mutation. An explicit execute envelope from a different session
also cannot take over an existing reserved attempt.

## Notification reconciliation and durable scanning

The notification journal already supported provider reconciliation, but the
recovery pipeline did not invoke it. The pipeline now reconciles its frozen plan
before considering delivery. Only verified evidence for the exact durable effect,
request and dispatch attempt can settle uncertainty. A missing, malformed or
ambiguous receipt leaves the attempt uncertain and never authorizes another send.
The inbox adapter can verify its existing pinned document. The FCM adapter still
has no authoritative remote receipt lookup and returns unknown; it must not infer
rejection from timeouts or absence.

`createScheduleRecoveryWorker` adds one bounded page per invocation, with a durable
server-private cursor and expiring lease. It checks host-supplied run authorization
before claiming, after claim acknowledgment and before checkpointing. Delayed or
lost claim acknowledgments do not start work. A lost completion response recovers
from the saved cursor. A failed/partial page retains the prior cursor until lease
expiry; a later worker retries that page through the existing journal. Per-item
retry results stay durable and are revisited on the next complete scan cycle.

Leases coordinate scanning only; they never authorize a send. A long-running
pipeline may outlive its worker lease, but cannot checkpoint over a newer worker.
Concurrent recovery of the same provider attempt remains governed by immutable
effect ownership and the delivery journal's dispatch identity. The new tests
expire a worker while its provider request is in flight and confirm a replacement
worker does not send again. The runner does not schedule itself, enumerate teams,
change consumer ownership, migrate the actual legacy trigger, or alter providers.

## Validation evidence

Passing validation at this checkpoint:

- 344 backend tests, including 13 replacement-session channel cases, 16 durable
  worker cases and four new pipeline reconciliation/concurrency regressions.
- 417 MCP unit/protocol tests across 15 suites.
- 102 tests across four emulator-backed suites using repository Firestore rules.

The composed MCP tests now close the original service/session, create a replacement
session against the same OAuth grant, and read committed or uncertain backend
status without another execution or form. A different grant is denied. The
emulator also verifies concurrent cursor leases and denies user reads/writes to
worker state. Another full composition writes one synthetic inbox notification,
loses the provider response, then reconciles the actual existing inbox document
through a restarted worker with no second send or business commit.

The missing reconciliation call has a failing-before regression: removing the
new `reconcilePlan` invocation leaves the recovered job `uncertain` instead of
`completed`. Restoring it passes. Synthetic provider receipts, ephemeral signing
keys and loopback/emulator identities are used throughout. No live identity or
FCM/provider behavior is established by these tests.

## Remaining gates

- Independent review of the new recovery purpose, grant isolation and worker
  composition; actual native ChatGPT/session behavior remains untested.
- Cross-grant recovery and authoritative reconciliation of an ambiguous business
  commit or a private proof whose channel completion update was lost. Such
  attempts intentionally remain unverified and never execute again automatically.
- Production SDK identity configuration, signing-key custody/rotation, fixed
  IAM/audience/host policy, shared-module packaging and multi-instance live-session
  routing remain unconfigured. Unknown sessions still fail closed.
- A reviewed scheduler host, authoritative team inventory, run authorization,
  bounded cadence/backoff, retention and alerting are required to run the worker.
  No scheduling or operational access was created here.
- Real platform trigger ingestion, audience readiness, legacy-consumer migration
  to shared ownership and a verified rollout gate remain prerequisites. The
  runner is not a substitute for migrating every existing sender first.
- FCM uncertainty lacks authoritative reconciliation, and complete create/update
  parity outside ordinary game/practice execution remains unfinished. Notification
  delivery still reports unverified; no production activation is authorized.
