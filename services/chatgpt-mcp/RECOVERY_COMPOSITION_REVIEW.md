# Isolated producer, trigger and recovery composition

See [SDK_IDENTITY_INTEGRATION_REVIEW.md](SDK_IDENTITY_INTEGRATION_REVIEW.md) for
the subsequent fresh-actor deadline guard and unmounted SDK identity adapters.

This checkpoint connects the actual MCP command writer to the private ordering
and delivery modules in isolated tests. It does not mount a production route,
deploy a worker, migrate the live legacy consumer, change grants or write live
data. It supersedes the implementation-status statements in
`PROOF_TRIGGER_ORDERING_REVIEW.md`; that document retains the ordering rationale
and manager-compatibility assessment.

## Implemented sequence

1. The existing broker captures explicit action and notification confirmation.
   The evidence authority consumes that exact action. Its internal
   `verifyConsumedApproval` rejects issued-only approvals, committed records and
   client completion receipts.
2. The optional producer adapter checks canonical audience readiness, then arms
   a private fence before the user-credentialed REST write. Known incompatible
   metadata selects the existing legacy route; temporary reads fail closed.
   Immediately before sending the commit, the writer durably changes the fence
   from `armed` to `dispatched`. It rechecks expiry after the persistence
   acknowledgment and revalidates the actor/session after that wait. A final
   synchronous approval-deadline guard runs at the REST fetch boundary, after
   all awaited hooks. Neither acknowledgment grants data access.
3. The trigger adapter retains the verified event fields, version, predecessor,
   actor and notification text in a server-private recovery job before capture
   acknowledgment. The ordering index derives its event digest from that saved
   payload. The business write and capture are separate operations: platform
   redelivery remains necessary if capture fails.
4. Verified commit evidence publishes proof through the same fence. A captured
   event with pending proof waits. After expiry, recovery can durably close the
   proof path and resolve the event to legacy. Late proof cannot transfer an
   existing owner. A lost commit response never causes another business write.
5. The worker freezes both complete, provider-pinned delivery plans before
   ownership selection. Known incompatible canonical metadata makes only legacy
   eligible. Temporary audience failures retain the payload without an owner.
   Retries use the saved plan rather than rediscovering a different audience;
   current actor, recipient, source and provider authorization must still pass
   before each dispatch.
6. Both modeled owners use the actual notification-attempt journal. Unknown
   provider results remain durable and are not blindly resent. `completed`
   denotes terminal processing (accepted, suppressed or failed), not confirmed
   delivery to a device.

`functions/schedule-recovery-pipeline.cjs` provides the composition and a bounded
Firestore scanner. A page scans 20 private records with one lookahead record;
the caller must continue with its cursor and periodically restart a sweep so
work inserted before an earlier cursor is revisited. No TTL deletes pending
jobs, reservations or uncertain attempts. Payloads and frozen plans each have a
256 KiB bound; oversized input is rejected without capture acknowledgment.

An unstarted reservation can now be cancelled, including by expiry recovery.
Re-arming archives the cancelled record before replacing it. The old intent hash
cannot dispatch or cancel its replacement. Once dispatch was durably marked,
timeouts or a missing event do not prove that the write cannot still commit.
Such reservations are deliberately retained and cannot be automatically reused.

## Validation

The emulator composition uses the real OAuth broker, MCP form protocol,
session-bound authority, user-credentialed REST transaction, private Firestore
state, canonical audience adapter and inbox provider. A trusted-trigger callback
is simulated from the committed emulator event; this is not a Functions trigger
or native ChatGPT end-to-end test. Auth accounts and the legacy audience planner
are synthetic. No real message provider or production account is contacted.

Validation in this checkpoint:

- **235 backend tests**, 13 suites:
  `node --test functions/test/schedule-*.test.cjs functions/test/notification-attempt-journal.test.cjs`.
- **397 MCP tests**, 14 root unit suites (all `chatgpt-mcp-*.test.js` excluding
  rules suites), including existing session, permission and confirmation tests.
- **65 emulator tests** across `chatgpt-mcp-broker-evidence-rules.test.js`,
  `notification-attempt-journal-rules.test.js` and
  `chatgpt-mcp-schedule-rsvp-rules.test.js`.
- **145 existing notification tests** passed in the preceding composition
  checkpoint: `npm --prefix functions run test:notifications`. Those paths are
  unchanged by the subsequent dispatch-acknowledgment fix.

Regressions cover concurrent recovery, payload persistence with lost responses,
restart with frozen plans, early trigger arrival, lost business-commit response,
readiness changes before ownership, temporary discovery failures, pre-dispatch
cancellation, stale handles, uncertain provider responses without resend,
private-record denial, strict identifiers and 43-record scanner pagination.
The 26 existing manager-versus-rules comparisons remain in the emulator suite.
These counts describe these commands, not complete repository coverage.

The delayed-acknowledgment regression failed on the preceding checkpoint:
`beginWrite` persisted before expiry but returned after expiry and still let the
writer proceed. Five bridge regressions also reproduced expiry, disconnection,
identity/scope changes during the wait, and expiry without a producer adapter.
The fix rejects these before fetch. A separate test expires the approval in a
microtask after the asynchronous hook and proves the final REST guard prevents
the commit. Emulator cases exercise expiry, revocation and actual MCP session
closure after dispatch acknowledgment: zero business commits, zero sends and
no private commit evidence, with the dispatched fence retained even after
recovery. Test-only cleanup releases emulator transaction locks after assertions;
the application does not bypass revoked credentials to perform rollback.

## Activation prerequisites still open

- Migrate the actual legacy schedule triggers to the same immutable ownership
  gate and durable journal, preserving their real audience, channel and content
  semantics. The isolated legacy planner does not establish this compatibility.
- Wire and review authenticated platform trigger capture, broker/backend
  transport and producer construction. The deployed entry points are unchanged.
- Deploy no recovery scheduler until team enumeration, sweep continuation,
  retries, dead-letter retention, queue limits and operational alerts are
  reviewed. A bounded scanner method alone is not an operational queue service.
- Define background actor/grant lifetime and revocation policy and implement the
  required current-delivery authorization adapter. Frozen plans are never
  permission to send. No new refresh credential or persistent grant is stored.
- Resolve dispatched/no-trigger reservations through authoritative commit or
  rejection evidence; neither expiry nor an absent current document is enough.
  Even definitively rejected HTTP writes are not automatically recycled yet.
- Finish provider reconciliation, the manager-compatibility rollout decision,
  independent security review and isolated native-client integration before
  enabling any direct production operation.

PR #5153 remains the owned integration draft. Its denied metadata refresh is not
retried. This stage is divided into producer-state, recovery/readiness and
integration-evidence commits; it adds no dependent PRs or landing handoff.
