# Private player tracking completion checkpoint

This follows [the tracking-item checkpoint](TRACKING_PARITY_REVIEW.md). The
unmounted direct prototype now covers a bounded part of **8 of the 46 app write
workflow names**. The new name is `set_player_tracking_status`; the remaining
38 names still require app review. Neither count means full workflow parity.
Production MCP and Functions entry points remain unchanged.

## Implemented behavior

`prepare_player_tracking_status`, `confirm_player_tracking_status`, and
`get_player_tracking_status_action` prepare, confirm and reconcile one explicit
complete/incomplete value for an exact active roster player and private active
tracking item. Existing item and player discovery provide the IDs. The preview
includes the item, player and previous/requested completion; conversational
`confirmed: true` cannot replace the session-bound, one-use form approval.

The payload matches `buildTrackingStatusPayload` in
`js/tracking-status-admin.js` and `setTeamTrackingStatus` in `js/db.js`, used by
`setPlayerTrackingStatusForApp` in the React app. It writes only the exact
`memberTracking/{playerId}` record with current roster display fields, consistent
boolean/status values, actor UID and timestamp. The optional email audit is
null. It does not change item visibility, player fields, other completions or
send notifications. No Functions trigger for this collection was found.

The command uses current manager authorization, the user's REST credentials and
existing Firestore rules. Team, item, player and completion revisions are bound
to the approved proposal. Publication, archival, deactivation, roster edits or
concurrent status changes require a fresh review. Public/archived items,
malformed players and legacy/conflicting/extended completion records require app
review; existing notes or unknown fields are never silently discarded.

Full proposal text remains within the existing manager-only team boundary.
Personal metadata carries opaque identifiers, and completion atomically removes
the team proposal payload and retains a minimal receipt. Lost commit responses
are reconciled through that receipt without automatically repeating the write.

## Validation and limits

Validation passed **481 MCP tests across 17 suites** (31 new status cases) and
**121 tests across five emulator-backed suites** (eight new status cases).
The preceding checkpoint passed 353 backend tests; this slice changes no backend
code. The emulator suites explicitly load the repository's compacted rules.

The new unit/protocol suite covers app payload/read-model parity, both values,
real MCP form elicitation, strict arguments, cancellation, absent authority,
preview tampering, current permission/expiry/revision checks, unsupported legacy
records, scoped adapter paths, lost responses and status reauthorization.
Emulator cases exercise actual rules-enforced create/update, private metadata,
unrelated-record preservation, publication/archival/player changes during the
form, denied commit credentials and response-loss reconciliation.

This is an ordinary user-credentialed domain, not a signed schedule/backend
operation. No real credentials, grants, team records or messages were used.
Client end-to-end integration, independent review, host composition, credential
custody and multi-instance session routing remain activation gates. The separate
notification fix guards provider callback entry; authorization/lease validity
across later awaits inside inbox/FCM SDK adapters still needs review and testing
before activation. Actual legacy-consumer migration and notification rollout
remain gated. Attendance is still unsupported: preserving existing per-player
notes and timestamp precision during full-array updates needs separate design.
