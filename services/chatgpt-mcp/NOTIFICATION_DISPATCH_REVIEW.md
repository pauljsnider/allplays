# Notification dispatch acknowledgment hardening

Independent review of `242aec47` reproduced provider dispatch after actor or
recipient revocation and after lease expiry while awaiting the durable dispatch
marker acknowledgment. The journal's earlier authorization check was insufficient:
the acknowledgment could arrive after the state authorizing the send had changed.
This was an unmounted prototype issue, not an observed production send.

After recording (or recovering) the dispatch marker, the journal now rereads and
validates the exact durable request, dispatch attempt and active lease. It checks
current actor, recipient and source authorization again with the explicit phase
`after_dispatch_ack`. Finally it checks the same lease deadline synchronously,
with no awaited work before invoking the configured provider callback.

Denial, unavailable authorization, stale durable state or expiry does not clear
the dispatch marker or make the attempt retryable. The existing failure handling
retains it as uncertain. A later restart cannot send again without authoritative
provider evidence. Successful sends and final late provider responses retain the
existing receipt reconciliation behavior.

Nine new regressions all failed before the change and pass after it. They cover
actor/source/recipient revocation during marker acknowledgment, expiry during
acknowledgment or the final authorization await, revocation/expiry during recovery
of a lost marker acknowledgment, a stale acknowledgment whose durable state has
changed, and unavailable post-marker authorization. The prior unreadable-success
regression now injects its read failures specifically after the successful result
commit, preserving that test's intent despite the additional pre-send read.

Validation: **353 backend tests**, **417 MCP unit/protocol tests**, and **105 tests
across four emulator-backed suites**. Three new emulator cases change real team
actor/recipient state or advance the lease clock during the actual private
transaction acknowledgment. All assert zero provider calls, retained uncertainty
and zero calls after permission is restored and delivery is requested again.

The synchronous guard protects entry to the configured provider callback. Provider
adapters and any later credential/network awaits remain separate integration
boundaries requiring review; these tests do not establish real SDK, network or
live-provider behavior. No production sender, credential, permission, route or
scheduler was activated. The production migration and other gates in
[RESTART_RECOVERY_REVIEW.md](RESTART_RECOVERY_REVIEW.md) remain open.
