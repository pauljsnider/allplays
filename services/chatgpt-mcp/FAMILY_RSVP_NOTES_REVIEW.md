# Staff-only family RSVP notes

This follows the [team setup checkpoint](TEAM_SETUP_PARITY_REVIEW.md). The batch
extends the already-counted `update_rsvp` and `update_rsvps_for_children`
counterparts with note creation, replacement and clearing. Coverage remains
**19 of 46 app workflow names partially direct**, with **27 app-review-only**;
this expands behavior within two names rather than claiming two new names.

## Supported operations

`prepare_linked_child_rsvp_with_staff_note` prepares one selected linked child's
response and exact note. `prepare_linked_children_rsvps_with_staff_note` prepares
the same response and note for 1–10 explicitly selected linked children on one
ordinary event. `confirm_family_rsvp_staff_note` requests actual one-use form
approval; `get_family_rsvp_staff_note_action` reconciles the same proposal.

The note argument is required. It must be trimmed, at most 2000 characters and
free of unsupported control characters; internal line breaks are supported.
Explicit empty text clears the selected note text to null, matching the app's
normalization, without deleting the record. Missing text never means clear.
The separate default-false `staffRsvpNote` acknowledgement names the selected
children, replacement/clear operation and audience. A model `confirmed` flag,
conversational yes or ordinary response-only confirmation cannot substitute.
The old response-only tools still preserve notes and cannot read/write them.

Responses remain in team-readable `rsvps` documents. Note text is stored only in
this author's child-specific `rsvpNotes` records, visible under existing rules
to the author and current authorized team staff. Another linked parent does not
receive staff-only notes. The whole selected response/note batch and completion
receipt commit atomically; a lost response reconciles without another mutation.
No messages are sent and cached RSVP aggregate totals are not refreshed.

## Authorization, audience and preservation

The extension requires the same exact current canonical parent/team/player
links, active children, ordinary event, cutoff, session-bound approval and final
dispatch checks as the response-only domain. It rechecks team, user, event,
children, response and note revisions. A changed audience, competing note or
revoked link invalidates the entire proposal. Team-visible note settings,
unknown/nested legacy audience settings and existing team-visible notes require
app review. These tools never change audience settings or downgrade/upgrade an
existing record's audience implicitly.

Base/family response or note records require app reconciliation. No base record
is created, removed or rewritten, preserving access-bearing base RSVP behavior.
Other authors' notes are outside the adapter. Existing note records must have
canonical author/child identity and supported fields; legacy email fields,
unknown extensions and malformed metadata fail closed. The adapter also rejects
new non-staff note payloads, audience-changing patches and note deletion.

Existing notes are read for validation/revision binding but their prior text is
not copied into pending previews or personal proposals. Only the user's new
supplied text appears in the proposal, with the explicit replacement/clear
instruction. Completion reduces that proposal to an opaque receipt without
note text. This does not promise deletion of abandoned pending input: the shared
proposal has a five-minute execution expiry, not an automatic retention purge.
History fields such as `createdAt` remain untouched through field-mask patches;
no original timestamp or unrelated value needs re-encoding.

Reviewed producers and consumers include `privateAiService.ts`,
`scheduleService.ts`, the separate-note writer in `js/db.js`, shared
`availability-preferences.js` and `firestore.rules`. The tests exercise the
actual app note normalizer and availability-note consumer. The inspected
Functions entry point has no RSVP or RSVP-note notification trigger. No deployed
Functions source or rules were changed. This remains a bounded child-specific
path; the app's base-family reconciliation and summary refresh are not copied.

## Validation and remaining gates

The selected regression set passed **752 MCP tests across 23 suites** and
**217 tests across eleven emulator-backed suites**. New coverage comprises
41 unit/protocol tests and 16 emulator/rules tests. The suites load the actual
repository rules into a loopback demo project and use only synthetic data.
`git diff --check` and Node 22 direct-module loading passed. The prior 353 backend
tests remain historical; this batch changes no backend source.

Coverage includes create/replace/clear, strict input and actual form schemas,
separate note approval, response-only isolation, staff/author privacy, another
linked parent's denial, anonymous denial, complete ten-child atomic writes,
historical timestamp preservation, existing-note validation, stale audience and
membership, cutoff/expiry/disconnect, wrong/unverified commit credentials,
competing notes, no partial writes and lost-response reconciliation.

Independent review of this extension, live MCP/native clients, live identity and
credential handling, actual production contention, mounted host/session routing
and existing notification rollout gates remain open. No new write domain name
is counted, and full parity is not claimed. Medical/profile edits, team-visible
notes, base-family reconciliation and notification-producing workflows remain
outside this batch.

Production entry points remain unchanged and unmounted. No credentials, access
grants, live data, payments, PR metadata, deployments or additional PRs changed.
The sole draft remains #5153 with external ownership retained.
