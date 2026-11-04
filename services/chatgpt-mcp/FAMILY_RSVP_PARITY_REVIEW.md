# Linked-family availability batch

Historical checkpoint; see the subsequent [practice operations batch](PRACTICE_OPERATIONS_REVIEW.md)
for expanded attendance/timeline coverage and preservation architecture.

This follows the [assignment lifecycle checkpoint](ASSIGNMENT_PARITY_REVIEW.md).
It adds direct counterparts for `update_rsvp` and
`update_rsvps_for_children`: one currently linked child's response, or an atomic
response for 1–10 explicitly selected linked children on one ordinary event.
The prototype now has bounded counterparts for **13 of the 46 app write
workflow names**; **33 remain app-review-only**. This is not full parity or
production availability. The previous checkpoint lists the other 11 covered
names and all remaining names; remove only these two RSVP names from its
app-review-only list.

## Scope and deliberate differences

`prepare_linked_child_rsvp`, `prepare_linked_children_rsvps`,
`confirm_linked_children_rsvps`, `get_linked_children_rsvps_action`, and
`list_my_linked_rsvp_children` are optional authenticated direct-session tools.
They require exact IDs and an explicit going/maybe/not_going response, followed
by one-use form approval of all selected children and their previous/new values.

The normal app's `submitParentScheduleRsvpForChildren` calls the grouped/base
RSVP writer. A base response also participates in confirmed-member access rules.
This bounded counterpart instead atomically writes the app-compatible
child-specific schema used by `submitRsvpForPlayer`. It never creates, changes
or deletes the base response. If a base response already exists, preparation
fails closed for app reconciliation. This avoids implicitly altering access.

Notes are neither accepted, read, copied nor written. Existing private/team
notes, other responders, unselected children and cached aggregate totals remain
unchanged. Existing canonical response records preserve their display name;
new records use the permitted null display name rather than copying a contact
or email. Note editing, grouped/base reconciliation, automatic selection of all
children and aggregate-cache refresh remain app workflows. There is no RSVP
document trigger in the current Functions source, and this path sends no
messages. The shared parent read model recognizes the resulting per-child
records; that compatibility is covered by a regression.

## Authorization, privacy and dispatch

Both current context and authoritative `parentTeamIds`/`parentPlayerKeys` must
match every selected team/player pair. Manager status, legacy `parentOf`, a
same-ID child on another team or another household's linkage cannot substitute.
The user profile, team preferences, event, active player documents, selected
responses and absent base record are all transaction revision dependencies.
No rules, credentials or grants were changed.

The actor's owner-only personal proposal contains only the selected child names,
IDs, event summary and response preview, already readable by that linked parent.
It does not contain medical/contact fields, unrelated roster players, event
notes or availability notes. Completed proposals become minimal receipts without
names or preview text. Status/discovery recheck current canonical links;
revocation of any selected child denies access through these tools.

Availability cutoff normalization matches the shared app helper. Cutoff is
checked during preparation, confirmation, before commit and synchronously just
before REST dispatch. Testing that final boundary also reproduced two shared
ordinary-command races: form expiry and disconnect after awaited dispatch
preparation. Both new regression cases failed before the hardening change and
pass after it, with no writes. Consuming the real approval now returns a
synchronous guard over the live-resolved actor binding/expiry, form deadline,
preview digest and abort signal; the common executor invokes it after awaited
dispatch preparation. Proposal expiry and the domain cutoff are checked there
too. Existing signed-backend evidence guards remain composed into that boundary.
Synthetic trusted adapters may still supply their own consume implementation;
production composition must use the real bound authority and REST writer.

Lost commit acknowledgments reconcile the atomic receipt without repeating any
child write. A malformed/extended existing response, missing/inactive child,
changed link, new base response, cancellation, stale revision or cutoff rejects
the entire batch. No automatic partial completion or mutation retry is provided.

## Validation and remaining gates

The full selected regression set passed **564 MCP tests across 19 suites** and
**152 tests across seven emulator-backed suites**. The earlier checkpoint's
353 backend tests are historical; this batch does not alter backend source.

The new suite has 43 unit/protocol cases and 13 emulator/rules cases, including
the real ten-child transaction, privacy denial, per-child link revocation,
wrong commit credentials, unchanged note timestamps, lost responses and shared
parent-read-model parity. The emulator suites load the repository's compacted
rules explicitly. These are isolated demo accounts, not live client validation.

Independent review of this batch and the shared final-guard change remains
pending. Live client integration, host composition, credential custody and
multi-instance session routing remain gates. Notification rollout still needs
authorization/lease checks across provider SDK awaits, actual audience
verification, recovery and single-consumer migration. Existing production entry
points remain unchanged and unmounted; no live writes, access changes,
deployment, new PR or PR metadata change is included.
