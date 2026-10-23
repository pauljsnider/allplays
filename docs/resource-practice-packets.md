# Web resource practice packets

## Coach quick start

On the modern web app, open a team's **Drills**, then **Create resources and
assign practice packets**. Save an HTTPS link, title and teaching point, or find
an existing library drill and use its link. This searches the AllPlays library;
it does not search YouTube or inspect video content.

Choose one or more saved resources, the current roster or selected players,
optional practice, and an optional due date in the displayed local timezone.
Save the draft. Families cannot see drafts. Select **Review publication**, check
the recipients and resource versions, and explicitly confirm publication with
or without notification. Notification preferences apply; this flow uses the
existing practice inbox/push channels and does not promise email delivery.

Editing a reusable resource does not change an existing published packet.
Saving and publishing a packet again creates a new version and resets its
current progress. Prior evidence remains versioned. The staff view displays
the current version; load additional pages when prompted.

## Family experience and truthful evidence

Use **Family practice packets** on Home or **Schedule → Packets**. Existing
practice packets remain alongside the new resource queue. Select a child and
team before opening a resource. The deliberate button click opens an external
tab and records **Link opened**, attributed to the signed-in actor, child,
assignment version and resource version. It does not measure viewing time or
prove that a video was watched. A broken external destination can still have
an opened-link record. Automatic reads, previews, hover and AI reads do not
record opens.

**We report: watched** and **We report: practiced** are separate optional
self-reports. Co-guardians can report for a linked child. A linked player may
access their own task through the authorized API; the current Schedule queue
uses the app's existing linked-child discovery. Other families cannot read
the evidence, even if they belong to the same team.

AI can read authorized notes and progress, clearly identifying self-reports.
Coach resource/draft/publication changes use the existing explicit-confirmation
pipeline and revalidate permission and revision at execution. AI has no access
to the contents of linked videos and cannot record a link open.

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
off regardless of the build value. Enabling the variable requires the feature's
security/release approval; these instructions do not grant that approval.

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

Local validation has passed the 12-case real Auth/Firestore/Functions suite,
the real outbox/Auth-deletion trigger test, the isolated real-component browser
flow, 201 AI tests, and the 145-test notification suite. Independent security
review confirmed the deletion-attribution and complete-recipient-preview fixes.
The full React suite passed 3,586 tests. The full root run passed 7,048 tests;
its sole remaining CSS subprocess failure was a relative preload path in the
local test invocation, and that exact test passed with an absolute path. The
Functions suite passed 1,616 tests; its credential-probe test passed separately
with DNS access, and seven existing emulator-only tests require the standard
rules suite. These are local results, not exact-head CI or deployed acceptance.

Still required: standalone player-login UI discovery/acceptance, full-shell
authenticated preview, exact-head CI, security-sensitive backend rollout approval,
shared release-hold disposition, and exact deployed revision verification.
The draft PR must retain its ownership claim until the authorized handoff.
