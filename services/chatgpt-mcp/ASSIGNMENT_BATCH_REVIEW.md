# Atomic volunteer-slot creation and updates

This extends `manage_schedule_assignment` with multiple related edits in one
review. Coverage remains **20 of 46 app workflow names partially direct**, with
**26 app-review-only**. It follows the [stat presentation checkpoint](STAT_PRESENTATION_REVIEW.md).
The direct router remains unmounted; this batch changes no production entry
point, credentials, permissions, live data or PR metadata.

## Supported workflow

Use `list_managed_event_assignments` to obtain current exact roles, then
`prepare_schedule_assignment_batch` with an exact team/event and 1–20 operations.
Each operation supplies `action=create|update`, its exact current/new role, and
the complete `assignment` object (`role`, `value`, `claimable`). Open slots have
an empty value. Creation appends in input order; updates retain their position.
The resulting event has at most 50 slots.

`confirm_schedule_assignment_batch` requests both ordinary approval and a
distinct `assignmentChanges` acknowledgement. The form shows every before/after
slot and every existing claim that will be removed, including stale destination
claims. Slot text is visible to authorized event readers. Affected volunteers
are **not notified** by this operation. Confirmation applies the complete batch
atomically. `get_schedule_assignment_batch_action` reconciles the same proposal
ID after interruption; prepared is not applied and an unknown outcome must not
be retried under a fresh ID.

Exact source/destination roles must belong to one operation only, compared
case-insensitively for collisions. Swaps, chained edits, removals, already-matching
rows and destinations occupied by other slots are rejected. Single-slot removal
continues to use the existing separate workflow. Recurring, imported, linked,
cancelled, live and special-engine events, malformed/extended slots or affected
claims require app review.

Reopening a fixed slot with an existing stale claim is also rejected. The current
app update helper preserves a same-role claim when reopening a slot; this bounded
batch deliberately refuses to silently reactivate that old claim. Reopening a
fixed slot without a claim is supported. Unselected claims are preserved.

## Shared implementation and boundaries

The single and batch commands share the existing slot-operation validator and
store policy. The single-command behavior and schema remain unchanged. The new
batch additionally rejects generic event/claim replacement writes. Its only
business writes are one field-mask patch of `assignments` and exact claim
deletions. It does not write notification, access, score, timing, player or
private-profile data.

Current manager authorization, event/team revisions and every affected source
and destination claim revision are checked again before confirmation commits.
Concurrent parent claims therefore invalidate the proposal or conflict with the
same transaction; a stale batch cannot erase an unreviewed new claim. The shared
one-action authority and final synchronous guards still apply. There is no
automatic business-write retry.

The complete proposal, including displayed claimant names, uses the existing
manager-only team payload boundary. The personal header and completed receipt
contain opaque identifiers/digests only. Completion and team-payload removal are
atomic with the business mutation. Unselected event fields and claim documents
remain on the server, preserving timestamp precision and unknown extensions.

Tests execute the actual app's create/update assignment helpers with isolated
persistence adapters and compare their supported slot/claim-cleanup results.
They also execute the actual backend notification classifier: changing only the
assignment array selects no notification category. This is not a live-delivery
test or permission to activate a notification consumer.

## Validation and gates

The new suites pass **45 unit/protocol tests** and **13 actual-rules REST tests**.
The focused regression run, including existing individual manager and parent
claim flows, passes **85 unit/protocol tests** and **31 emulator-backed tests**.
Coverage includes the maximum 20-row batch and 20 claim removals, duplicate and
overlapping roles, exact confirmation, scope denial, revocation, stale claims,
delayed expiry/disconnect, atomic denied commits, team-private proposals, stored
timestamp preservation, lost-response reconciliation and a real emulator
transaction racing a parent claim. The emulator may abort both competing lock
upgrades; neither path automatically retries or leaves partial changes.

All **980 selected MCP tests across 29 suites** pass across the initial run and
the loopback-enabled rerun. The sandboxed run passed 960 tests; 20 HTTP cases
could not bind loopback (`listen EPERM`). All **53 tests in the three affected
suites** subsequently passed with local loopback permission. No code change was
needed for that environment restriction. Node 22 imports and `git diff --check` pass.
Earlier full emulator/backend counts are historical and are not claimed as new
validation of this batch.

Independent review, live identity/native client integration, deployed Firestore
contention, credential custody and multi-instance composition remain gates.
Existing sensitive-profile/RSVP pending-text cleanup and external transcript
retention gates remain open. No production activation, notification rollout,
new access grant, additional PR or PR-description update is included.
