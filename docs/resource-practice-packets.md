# Web resource practice packets

## Coach quick start

In the modern web app, open a team's Drills and its assignment link, or use
Schedule → Packets → Manage team assignments. The assignments dashboard shows
completed-player counts. Choose **Share a video**, paste an HTTPS link and give
it a short title, or choose an existing resource/drill. Add an optional coaching
note. The current team and whole roster are the default context; change the
visible audience, due date or notification preference as needed.

YouTube links show a thumbnail when available; other links show their source.
**Preview video** opens the external site without recording completion.
**Preview family view** shows the card families will receive. Add another video
for a multi-item assignment. **Assign & notify** explicitly shares the assignment
using eligible existing channels/preferences; email is not guaranteed. There is
no separate save-resource/reselect/draft/publication wizard. An uncertain send
can only retry the same frozen publication, not silently send a new one.

Use **View progress → Outstanding** for players who have not opened every item.
Notification delivery is shown separately and never proves viewing. Text-only
corrections retain completion for unchanged item IDs and exact destinations;
new or replaced videos require an open. Old version evidence remains retained.

## Family experience and truthful evidence

Home shows the number of unfinished video assignments with links for each child.
Notifications open the specific assignment. One eligible assigned child opens
directly; siblings require deliberate child selection. The assignment destination
survives sign-in. Existing Schedule and player-resource links remain supported.

**Watch** opens the external video and records an authenticated **Link opened**
event. That item becomes **Complete — video opened** without another checkbox
or Save action. A multi-video assignment is complete when all items were opened.
This records a click, not playback or viewing time. A broken external destination
can still have an opened-link record. Reads, previews, hover and AI never record
opens. Blocked popups do not record completion. Failed writes do not report
success; explicit retry retains its idempotency identity.

Optional practiced feedback is secondary. Existing watched/practiced evidence
is retained without being relabeled as verified playback. Co-guardians share
child completion; one child's click never completes a sibling's task.

Contextual AI entry points prepare editable coaching assistance or reminder text
and answer authorized progress questions. Existing write actions require explicit
confirmation and revalidate permissions/revisions. AI cannot inspect linked video
content, claim playback, record an open, or silently notify families. Manual
sharing and progress review do not require AI.

## Delivery states and recovery

- `pending`: no provider attempt claimed. Staff may explicitly retry pending
  delivery after a temporary failure or rollout pause.
- `dispatching`: a single delivery boundary was claimed. After 15 minutes,
  staff can reconcile it to `uncertain`; this never resends.
- `sent`: the adapter completed without reported failure; this is not proof
  that a person received or read a notification.
- `partial`: one or more adapter effects reported failure.
- `suppressed`: no eligible current recipients remained.
- `uncertain`: an effect might have occurred. Automatic resend is prohibited.

The delivery key is stable for team, assignment and published version. Inbox
records use that identity. Final dispatch rechecks child linkage, task version,
deletion barriers, Auth eligibility and existing category/device preferences.

## Isolation, QA and synthetic demo

Run from the repository root after installing root, app and Functions packages:

```sh
npm run test:resource-packets:emulators
npm run test:resource-packets:triggers
npm run test:resource-packets:browser
```

These commands use `demo-allplays-resource` with local Auth (9299), Firestore
(8280) and Functions (5201). Missing emulators fail the test. They load the
production feature core/handlers/trigger wrappers into a disposable harness,
not the production trigger fleet. The trigger suite substitutes a local
recipient sink for provider dispatch. Separate notification tests exercise the
actual existing preference resolver and direct-target adapter. Non-local
network requests in test processes are blocked. No production credentials,
persistent users, customer notifications or production fixture writes are
needed. The browser suite mounts the real feature pages against real emulated
callables and Auth; its library adapter uses local Firestore to avoid initializing
the separate image project. It is not a substitute for full-shell preview QA.

Browser fixtures demonstrate desktop coach creation and mobile-width family
viewing, deliberate click recording, optional self-report and sibling/family
separation. They also exercise resource revisions, multi-item publication, a
Chicago due date, keyboard confirmation, touch opening, a synthetic external
404 and offline retry without duplicate evidence. They use only synthetic names and example.invalid identities.

## Authorization and release gates

The new `resourcePacketTeams` hierarchy is server-only under the existing
Firestore default denial. No Firestore allow rule is added. Callables validate
current Auth, verified email, user/team state, staff ownership/admin membership
or canonical parent/player linkage. Evidence is not stored under legacy packet
completion rules. Account deletion creates a transaction barrier, removes
private actor evidence/operation results, and scrubs attribution from shared
resources and current progress, with bounded resumable cleanup.

`RESOURCE_PACKETS_ENABLED` is a nonsecret rollout variable, default false.
The production workflow packages it into the Functions environment and builds
the web UI with `VITE_RESOURCE_PACKETS_ENABLED`. Native runtime gates remain
off regardless of the build value. Enabling the variable follows the authorized feature release and existing
release gates; these instructions do not grant authority to change access settings.

Before release: exact-head CI, independent review, full-shell authenticated
preview acceptance, the existing PaulBot landing process, and the exact deployed
revision's synthetic production smoke must pass. Production extended writes
remain off until recipient isolation and asynchronous reconciliation are
explicitly verified. Existing shared release holds are not cleared by these tests.

Rollback: set the rollout variable false and redeploy through the authorized
release process. Do not delete version/evidence records, broaden rules, replay
uncertain deliveries, or restore a prior version over newer progress. Pending
deliveries remain unsent while disabled and require explicit staff recovery
after re-enabling. Account-deletion cleanup remains active while the UI is off.

## Release copy (draft, not a delivery claim)

Share a focused practice packet with your team or selected players. Families
can open coach-picked resources and report what they watched or practiced.
Coaches can review private progress without pretending a click proves viewing.

## Pre-release validation checkpoint

Local validation has passed the 13-case real Auth/Firestore/Functions suite,
the real outbox/Auth-deletion trigger test, the isolated real-component browser
flow, 201 AI tests, and the 145-test notification suite. Independent security
review confirmed the deletion-attribution and complete-recipient-preview fixes.
The full React suite passed 3,586 tests. The full root run passed 7,048 tests;
its sole remaining CSS subprocess failure was a relative preload path in the
local test invocation, and that exact test passed with an absolute path. The
Functions suite passed 1,616 tests; its credential-probe test passed separately
with DNS access, and seven existing emulator-only tests require the standard
rules suite. These are local results, not exact-head CI or deployed acceptance.

The standard existing rules suite also passed 358 cases and all 45 friend-invite
tests without skips. Separate player login, library search and player actor
attribution passed in the isolated browser flow; player-detail regressions and
client tests passed 60 cases.

Home → My player practice resources now discovers the signed-in account’s
linked players, including self-only player ownership. The real App/Auth/Home
shell sign-in and navigation passed against isolated Firebase adapters. This
uses three player ownership collection-group indexes, deployed before activation.
The harness does not deploy unrelated Functions, so unrelated Home sections can
report unavailable data; the packet journey is exercised through real callables.

Still required: hosted authenticated preview, exact-head CI, shared release-hold disposition, and exact deployed revision verification.
The draft PR must retain its ownership claim until the authorized handoff.

CI remediation: DOMPurify was patched from 3.4.16 to 3.4.17 to clear the existing
production dependency audit. No audit exception or threshold was changed.
