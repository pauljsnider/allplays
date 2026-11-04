# Proof/trigger ordering and manager compatibility

This is an unmounted protocol model. It changes no live consumer, Firestore rule,
credential or team data. The production pre-commit hook, private index adapters,
trigger authentication and recovery worker still require implementation/review.

## Ordering invariant

Missing proof is not sufficient evidence that a write belongs to legacy.
`functions/schedule-proof-ordering.cjs` distinguishes a known legacy effect,
a pending approved producer, and a verified proof. The eligibility interface
now requires an explicit resolution; null/undefined/pending cannot reserve
legacy ownership.

The proposed sequence is:

1. After the existing backend authority consumes the exact approved action,
   persist a private producer fence **before** starting the user-credentialed
   business write. Bind team, event, predecessor updateTime (null for create),
   expected canonical event digest, actor UID, intent digest, approval ID and
   expiry. Wait for a verified persistence acknowledgment. This fence does not
   authorize the write; the existing command engine still does that.
2. The authenticated Firestore trigger captures the actual commit version,
   predecessor and content digest in a durable private routing inbox. Both
   notification consumers resolve the same index before reserving ownership.
   A matching pending fence produces a retryable `proof_pending` result and no
   owner. Unrelated ordinary legacy effects remain legacy.
3. Publication verifies the real private commit proof and atomically changes
   the producer fence from pending to proof. The trigger can then select journal
   ownership, subject to the existing per-effect eligibility checks. Proof may
   arrive before or after the trigger without changing the result.
4. If the producer crashes or cannot establish proof, a recovery worker may,
   after the bounded approval expires and a matching trigger was captured,
   atomically close publication and assign the path to legacy. **Expiry alone
   does not route a message.** Closure is durable and terminal. Proof publication
   and closure race on the same transaction record; whichever wins determines
   the only route. A late proof cannot reopen a legacy-closed path.

Consumer ownership remains immutable. This design removes the need for a late
transfer. Lost publication/closure responses are resolved from the private
record; no notification or business write is replayed to determine the outcome.
A later legacy recreation with identical content but a different commit version
cannot inherit an old journal proof.

## Delivery and recovery limits

The model persists routing identity, not the entire notification payload or a
complete operational queue. Before activation the host must durably retain the
verified trigger payload or a bounded notification projection, retry pending
inbox records, and run recovery after producer crashes. Dead-letter handling,
retention and alerts must preserve work across process/deployment failures.
An acknowledgment before durable capture is forbidden. Expiration/TTL deletion
must never discard pending fences, inbox records or uncertain delivery attempts.

A fence whose write never started remains retained. Safe cancellation/re-arming
requires authoritative proof that the old execution cannot still commit; this
model deliberately does not automatically recycle that reservation. The
producer must use the current command engine's one-action/idempotency controls,
not treat the `arm` acknowledgment as a new execution capability.

Both consumers must honor ownership and use compatible durable delivery state
before this can activate. The live legacy sender has not been migrated. Tests
compose the ordering model with the actual notification-attempt journal and a
counted synthetic provider. Retries and concurrent consumers produce one send
per test effect. An uncertain provider response remains uncertain and is not
resent or failed over. That is not a guarantee of exactly-once delivery by FCM;
provider reconciliation/acceptance limits remain unchanged.

## Compatibility assessment

Twenty-six isolated emulator cases compare the **full** canonical manager
adapter with the current Firestore rule on a manager-only write. Six permit
both paths, ten deny both, and ten are deliberately narrower in the prototype.
These are fixture counts, not counts of affected production accounts.

| Existing case | Rules | Prototype | Proposed rollout treatment |
| --- | --- | --- | --- |
| Exact owner ID; valid owner-email fallback; exact/lowercase Auth-email admin entry | Allow | Allow, with current enabled/verified Auth and user profile | Eligible for further checks |
| One ASCII space before/after/both sides of lowercased or exact Auth admin email | Allow | Deny that grant | Keep legacy/app path until an explicit compatibility decision |
| Global admin with no current team owner/admin grant | Allow | Deny | Keep scoped prototype exclusion unless explicitly reviewed |
| Unverified or phone-only owner | Allow on the tested manager-only rule | Deny | Review identity-policy compatibility; do not silently relax verification |
| Exact owner with no user profile document | Allow | Deny | Investigate through normal account support; do not fabricate profiles |
| Padded/tabbed owner ID, null owner ID with email fallback, tabbed owner email/admin grant, mismatched uppercase stored admin grant | Deny | Deny | Do not normalize these into new access |

A further team-level consequence is tested: even a valid exact owner cannot
complete canonical audience discovery when the team contains an unsupported
spaced admin-email entry. Therefore activation must gate **audience readiness**,
not just the initiating manager. Such teams must remain on the existing path
before producer arming/consumer selection; otherwise journal ownership could be
selected for an audience the new adapter cannot resolve. That readiness gate is
not wired yet, so this remains an activation blocker.

If parity for spaced admin emails is chosen later, implement only the rules'
finite exact variants—not general trimming/case-folding—and test both actor
authorization and candidate discovery. Do not rewrite stored grants as an
incidental migration. No production inventory was read, so prevalence is unknown;
a separately authorized aggregate compatibility audit would be needed before
rollout. The matcher is unchanged in this checkpoint.

## Validation scope

Unit tests cover both arrival orders, concurrent proof/closure transactions,
producer crash recovery, process restart, duplicate triggers, lost and false
persistence responses, expiry, unrelated/recreated legacy effects, and uncertain
provider response without resend. An emulator test exercises the race using
actual Firestore transactions and the actual delivery journal, and denies client
reads/writes of the new private fence and inbox records. Identity/trigger/provider
verifiers remain synthetic; these tests do not establish live platform wiring.

Final focused validation: **231 backend tests** across 13 suites and **44
emulator tests** across the broker/evidence and private journal suites, including
the 26 manager-compatibility comparisons and real-transaction routing race.
