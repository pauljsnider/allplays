# Resource practice packets

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
and answer authorized progress questions. Composer help opens a new tab with every
video, the coaching note, audience, due date, practice and notification choice;
the original unsaved composer stays open. Return to that tab to keep editing.
Opening AI does not save or publish. Existing write actions require explicit
confirmation and revalidate permissions/revisions. AI cannot inspect linked video
content, claim playback, record an open, or silently notify families. Manual
sharing and progress review do not require AI.

## Delivery states and recovery

Open **View progress → Notification status**. **Retry pending notification**
explicitly requests recovery; merely viewing status never sends. **Check
interrupted delivery (after 15 minutes)** reconciles an old attempt without
resending it. The server enforces eligibility and the waiting period.

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
the separate image project. With RESOURCE_PACKET_FULL_SHELL=1 it also exercises the real App/Auth route and exact-assignment login return. The unrelated public-profile projection callable explicitly returns unavailable in this fixture; it does not fake a successful profile sync.

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
the web UI with `VITE_RESOURCE_PACKETS_ENABLED`. Native packages use the same opt-in build flag, passed explicitly by both mobile workflows. Native calls use the current native Auth token and App Check. Before opening a family video, the app re-reads the exact assigned child/version; only a successful native browser launch is followed by an opened-link report. A failed launch records nothing, and a failed report after launch explicitly says progress is unconfirmed. Closing the browser returns to the still-mounted assignment; it never records another open. Cold-start and warm notification links retain the exact assignment. Coach previews never record progress; native coaching help opens in a dismissible in-app dialog so the unsaved composer remains mounted. Enabling the variable follows the authorized feature release and existing
release gates; these instructions do not grant authority to change access settings.

Before release: exact-head CI, independent review, isolated authenticated full-shell
acceptance, the existing PaulBot landing process, and the exact deployed
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
complete coach-picked resources by opening them, with optional practice feedback.
Coaches can review private progress without pretending a click proves viewing.

## UX validation and remaining release evidence

The redesign uses synthetic staff, parent, co-guardian, player and outsider
identities. Real Auth/Firestore/Functions tests passed 14 cases without skips;
the real outbox/Auth-deletion trigger sink passed. Notification resolver tests
passed 145 cases and permission/confirmation-scoped AI tests passed 201 cases.
The smoke repair covers cold content within the existing 25-second readiness
contract, notification dialog cleanup, and family loading/error assertions scoped
to the assignment region rather than the permanent shell accessibility status.
All 16 readiness tests pass; no timeout or security assertion is weakened.

Chromium and WebKit exercise the three journeys with mobile touch viewports,
text edits, media replacements, multi-item completion, sibling/household denial,
co-guardian attribution, blocked popups, offline retries, a synthetic broken link,
and exact assignment return through the real login shell. Screenshot evidence
uses synthetic data only. Browser automation timings are machine timings, not
human usability measurements; the 30-second sharing and 10-second review goals
remain human-test targets. No external video playback is verified.

The generated Firebase preview hostname cannot boot the production Firebase
configuration under the existing host guard. Do not weaken that guard or expose
production credentials to PR code. Use isolated authenticated acceptance before
merge and the existing protected designated-account smoke on the production
host after deployment. Production extended writes remain disabled. The
production fixture lacks separate player-login and second-household coverage;
those cases are established by isolated tests, not production claims.

Exact final-head CI, PaulBot review/landing and exact deployed-revision protected
smoke are release evidence, recorded in the PR rather than inferred from local
results. Keep unrelated PR holds intact.

### Native release acceptance

A native asset build must receive `VITE_RESOURCE_PACKETS_ENABLED=true` (the mobile
workflows inherit the repository/environment `RESOURCE_PACKETS_ENABLED` variable).
A successful web deployment does not update an installed app. Record the exact
source SHA and build number separately for iOS and Android before distribution.

Before store release, test the packaged application with dedicated test accounts:
coach create/edit/cancel, roster and due date selection, notification preference,
AI return with unsaved draft, family Home and notification entry, exact assignment
cold/warm links, external-browser launch and return, revoked access, account switch,
and offline/retry. Verify that a failed launch writes no `opened` signal and that
returning from the browser writes no additional signal. Follow the physical-device
and internal-distribution checklist in `mobile-store-release-runbook.md`.

Synthetic Capacitor shells using local Auth/Firestore/Functions emulators can
validate shared components and real Browser plugin behavior without live writes.
They do **not** establish production native authentication, App Check, push delivery,
full-shell layout, or physical-device acceptance. Keep these evidence categories
separate; an unsigned simulator app or debug APK is not a store release.
