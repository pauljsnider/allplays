# Private tracking batches and lifecycle

This checkpoint extends `set_player_tracking_status` and
`save_team_tracking_item`; it does not add another canonical app action name.
Coverage remains **20 of 46 workflow names partially direct**, with **26
app-review-only**. The [private-profile checkpoint](PLAYER_PROFILE_REVIEW.md)
remains subject to hard privacy gates. All direct paths are still unmounted.

## Operations

`prepare_player_tracking_batch` accepts one exact team/item and 1–20 distinct
active player IDs, each with an explicit `complete` boolean. It supports mixed
complete/incomplete values and creates missing completion records or updates
existing canonical ones. The form shows every selected player and previous/new
state. `confirm_player_tracking_batch` atomically applies all rows plus the
receipt, or none. `get_player_tracking_batch_action` reconciles the same UUID
following interruption. Unselected records, including legacy notes/history,
remain untouched. Existing single-player commands retain their behavior. Use the existing
`list_team_tracking_items` and `get_team_roster` discovery tools for exact IDs;
item discovery includes lifecycle state without exposing completion records.

`prepare_private_tracking_active` accepts one exact private item and explicit
`active: false` to archive or `active: true` to reactivate. The command updates
only the consistent `status`, `active`, `archived` triplet and update audit.
`confirm_private_tracking_active` requires ordinary approval and a separate
`trackingLifecycle` form acknowledgement. `get_private_tracking_active_action`
reads the same proposal's outcome.

Archiving removes the requirement from active lists without deleting its
completion records. Reactivation retains those records, including later
authorized edits. The form explicitly states this is not a completion reset or
snapshot. Completion rows are therefore neither read nor rewritten by the
lifecycle command. This permits an unrelated completion edit while lifecycle
approval is open without losing it or falsely claiming its state was reviewed.

## Boundaries and source parity

Both commands require current manager authorization and use only user-credentialed
REST transactions under existing rules. Only canonical private items are
accepted. Public visibility, legacy publication flags, unknown extensions or
inconsistent lifecycle fields require app review. Completion changes require an
active item, active supported players and canonical existing completion rows;
notes or other extensions on selected rows are refused rather than discarded.
An archived item's completion cannot be changed through these commands until a
separately confirmed reactivation succeeds.

The batch binds team, item, every selected player and every selected completion
revision. The lifecycle command binds team and item revisions. One-use session
approval, final dispatch guards, distinct tool identities, strict schemas and
atomic receipts use the existing shared command architecture. Changed receipt
player IDs are rejected. Lost responses reconcile the same receipt without
repeating writes or resetting statuses.

Full proposals stay behind current team authorization; personal metadata and
completed receipts contain opaque IDs/state, not names or checklist text.
Completion removes the team proposal atomically. Lifecycle writes cannot create,
replace or delete items, edit text or visibility, or modify completion records.
Item creation audit and existing stored timestamp precision remain on the server.
No rule, scope, access, messaging or payment behavior changes.

Tests execute the actual shared `buildTrackingStatusPayload`, and the actual
legacy and React tracking draft normalizers with isolated dependencies. The
status/audit schema matches the existing app, with nullable email audit. The
legacy/React status triplet is preserved for both lifecycle transitions.
`archiveTeamTrackingItemForApp` uses the same lifecycle patch; existing save
normalization supports reactivation. No tracking-path notification trigger was
found in the inspected Functions entrypoint. No backend or app runtime changes
are part of this batch.

## Validation and gates

The new suites pass **33 unit/protocol tests** and **14 emulator-backed tests**.
Coverage includes mixed create/update, the full 20-player bound, exact field and
history preservation, separate lifecycle confirmation, private proposal/audience
rules, changed roles/items/players/statuses, missing acknowledgement, forged final actor,
legacy refusal, expiry/disconnect and one-write lost-response reconciliation.
Rules tests explicitly load the repository's compacted rules in a loopback demo
project, not permissive emulator defaults.

The selected regression matrix passes **868 MCP tests across 26 suites** and
**264 tests across 14 emulator-backed suites**. After the final discovery-message
update, the three focused tracking suites pass again (**97 tests**). Node 22
direct-module imports and `git diff --check` pass. Previous backend results are
historical.

Independent review of this batch, real identities/native clients, production
contention, credential custody and multi-instance integration remain open.
Notification-provider internal guards and single-consumer rollout remain gated.
Bounded expired/abandoned sensitive-text cleanup and client/transcript retention
expectations are **hard preactivation privacy gates** for profiles and RSVP notes;
expiry alone never claims deletion. This batch does not relax those gates.
Production remains unmounted; no credentials, permissions, live data, PR metadata
or additional PRs changed. The sole draft remains #5153.
