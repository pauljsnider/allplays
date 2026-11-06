# Private incentive settings batch

This follows the [practice operations checkpoint](PRACTICE_OPERATIONS_REVIEW.md).
Four additional app workflow names have bounded direct counterparts:
`save_player_incentive_rule`, `toggle_player_incentive_rule`,
`retire_player_incentive_rule` and `set_player_incentive_cap`. The prototype now
covers **18 of 46 app workflow names partially**, with **28 app-review-only**.
These counts describe implementation coverage, not complete semantics or deployed
availability. All direct production entry points remain unmounted.

## Operation contract

| MCP preparation | Approved result |
| --- | --- |
| `prepare_create_player_incentive_rule` | Add one private positive-value rule; existing rules stay additive. |
| `prepare_revise_player_incentive_rule` | Close one current version and create its complete replacement atomically. |
| `prepare_set_player_incentive_active` | Set explicit true/false by versioning, without changing historical active state. |
| `prepare_retire_player_incentive_rule` | Close one current version; preserve its history. |
| `prepare_player_incentive_cap` | Set integer cents, including zero, or explicitly clear with null. |

`list_my_player_incentives` discovers the current parent's own rule IDs, configured
stat keys and cap for an exact linked team/player. `confirm_player_incentive`
requires both `approve` and the separate default-false `incentiveTerms` form field.
A conversational yes, `confirmed` argument, omitted acknowledgement or other
parent's ID cannot substitute. `get_player_incentive_action` reconciles the same
proposal after an interruption. New version IDs derive from the proposal UUID.
No payment-record operation, money transfer or notification is implemented here.

The form shows the exact child, before/after terms, current cap and additive rule
count. Cap approval explicitly states that the cap is **global, not versioned**:
changing or clearing it can change displayed earnings for past and future games.
Other rule changes start a new interval at commit time. Threshold rules support
`gt` and `gte`; per-unit rules require null threshold fields. Cents are explicit
integers, positive for rules and nonnegative for caps, capped at 1,000,000. Each
preparation is one action, not ongoing permission.

## Authorization and history preservation

The domain reads only the connected parent's own `users/{uid}/incentiveRules`,
own canonical profile, the selected active player and that team's stat
configurations. Current role, exact `parentTeamIds` and `parentPlayerKeys` must
agree. Manager access is not private-parent access. Cross-team reuse of the same
player ID fails closed because the legacy cap key and rule query use player ID
without a team-qualified key. Legacy/mismatched caps require app review.

User-credentialed REST transactions retain the existing Firestore rules and
verified-email gate. Source rules must be current, canonical, non-future and
positive-valued; historical/negative/extended source rules require app review.
The bounded query rejects over 100 rule/cap records or 100 configurations.
Malformed relevant fields and unavailable stat keys fail closed. Revocation or
changes to the player, source, target, cap, rule query or configuration query
invalidate preparation. No private contact or medical field enters the proposal.

The serializer has an opt-in domain policy for Firestore `REQUEST_TIME`
transforms. Incentive creation uses server timestamps for created/updated/start;
closing a version uses a transform-only write for updated/end. Old history is
never re-encoded: nanosecond timestamps and unrelated fields remain on the
server. Both interval boundaries receive the same commit timestamp, matching
the app's server-timestamp batch and avoiding broker clock drift. Other adapters
keep their existing timestamp behavior. The serializer preserves original Date
instances for the earlier practice attendance precision path.

Proposals remain private to their user. Completion atomically replaces the
proposal with a minimal receipt without terms or player name. The private receipt
is only an outcome record, never backend notification authority. Lost responses
reconcile it without a second business mutation. Ordinary rule deletion,
financial-history edits, other-parent access and paid-record paths are outside
the adapter. Cap deletion requires the same current parent authorization.

## Comparison with actual app workflows

Reviewed producers/consumers: `apps/app/src/lib/privateAiService.ts`,
`apps/app/src/lib/playerService.ts`, `js/parent-incentives.js`, and the private
incentive sections of `firestore.rules`. The tests exercise the app's actual
pure interval and earnings functions against the new records. No incentive
notification trigger exists in the inspected Functions entry point.

One existing app discrepancy remains outside this batch: the AI
`toggle_player_incentive_rule` resolver supplies the requested `active` value to
`toggleParentPlayerIncentiveRule`; the legacy helper then inverts that value.
The new explicit-state MCP command honors the requested approved state. The app
path has not been changed; it needs a separate focused fix and consumer tests.

`mark_player_incentive_paid`, penalties/negative rules, extended or legacy rule
reconciliation and historical rewrites remain app-review-only. Rideshare was
also inspected: offer/request creation and changes trigger actual notifications,
so direct rideshare needs the separately reviewed delivery integration first.
The 28 review-only names and unsupported portions of the 18 partially supported
names remain open; full parity is not claimed.

## Validation and production gates

The selected regression set passed **657 MCP tests across 21 suites** and
**182 tests across nine emulator-backed suites**. This includes 55 new
unit/protocol tests and 18 new emulator/rules cases. The prior 353 backend tests
are historical; this batch changes no backend source. `git diff --check` passed.

Coverage includes canonical parent privacy (including denial to team owners),
verified email, exact before/after forms, separate incentive acknowledgement,
atomic version boundaries, historical earnings and active-state behavior,
retroactive cap disclosure, server-time transforms under broker clock skew,
stored timestamp preservation, stale/competing versions, revocation, expiry,
disconnect, adapter path restrictions, lost-response reconciliation and strict
MCP schemas. Tests use only synthetic fixtures and a loopback demo-project
Firestore emulator, explicitly loading the repository's compacted rules.

Live ChatGPT/native client compatibility, independent security review, credential
custody, mounted host composition and multi-instance session routing remain
activation gates. The actual approval authority and REST writer must be used;
trusted custom adapters can omit final guards. Server time governs financial
intervals, while session/proposal expiry still requires a trustworthy broker
clock. Real contention, live identities and production integration are not
validated by these emulator tests.

Notification rollout still needs provider-internal authorization/lease checks,
verified audiences, durable recovery and single-consumer migration. No live
credentials, permissions, data, deployed consumer, PR metadata, deployment or
additional PR was changed by this batch.
