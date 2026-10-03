# Classic bounded-read and startup safety contract

The runtime/test patch reviewed at `f238f563d` was refreshed without conflicts
onto `f6792f3c1b63c7b231d3ee21f238afc1e1ec4ff3`. Its seven files were unchanged
by the rebase. The rollout adds the isolated emulator CI job and matching
production validation coverage. Reset redesign and permission expansion remain
excluded; no production game data is used by these tests.

## Runtime changes

1. Classic's zero-activity Start Timer preflight uses the existing full-history
   paginated `getLiveEvents` helper and its array length, replacing a remaining
   unbounded read. Existing data offers Resume or Cancel only. Cancel returns
   without local or persisted mutation for every role. The unsafe Start Over
   branch is removed from this preflight; the separate Reset button is unchanged.
2. Stat-sheet replacement preflight only needs to know whether live history
   exists, so its page-owned query now requests `limit(1)`.

## Real rules/browser coverage

`playwright.rules.config.js` starts an isolated loopback server on port 4177.
The actual Classic HTML, `js/db.js`, resume code and vendored Firestore SDK run
against the entire current `firestore.rules`. `getDocs` always calls the SDK;
its wrapper only records returned IDs and injects permission revocation after
page one. The fixed `demo-allplays-classic-contract` project and mandatory
`127.0.0.1:<port>` emulator address prevent production targeting. Browser
requests outside loopback are blocked. Fixture seeding/readback uses disabled
rules only inside the demo emulator; browser operations remain rules-enforced.

Auth identity/bootstrap and callable transport are adapted for tests. The
callable executes the production delegated-team-context core against seeded
emulator documents; no fabricated authorization result is returned.

The 23 tests cover:

- 0/20/21/40/41 tied timestamps, no missing/duplicate history, 15 roster rows,
  restored score, real chat subscription and viewer count.
- Owner/admin/delegated scorer: existing reset/undo history is interpreted
  correctly; score, persist, reload, undo, persist and reload use actual rules.
- Owner unbounded/21-row requests fail; outsiders/unauthenticated users cannot
  read/write the private game; signed-out Classic redirects to auth.
- Revocation after page one fails without partially restored history.
- Legacy report events are not invented as live events.
- Existing zero-score owner/admin games Resume with retained stats and a persisted
  running clock. Cancel for owner/admin/delegate leaves the full game document,
  aggregate/event/liveEvent collections, rendered roster/log and timer unchanged.
- Genuinely empty owner/admin games (no events/aggregates/liveEvents, empty
  opponentStats, false liveHasData, scheduled liveStatus) start without a dialog
  and persist a running clock.
- Stat-sheet's exact page-owned live-history read expression succeeds for
  owner/admin/delegate. This is not AI/upload/replacement end-to-end coverage.

No real sign-in/token issuance, deployed callable transport, React tracker,
public homepage score refresh or complete reset safety is claimed.

## Why the old CI missed the initial-load defect

PR #4948 CI DID run 22 emulator files / 315 tests. Rules coverage was not omitted.
Those tests exercised isolated rules requests, while browser smoke substituted
unconditional successful empty `getDocs` and a fake database module. The actual
Classic query was never coupled to the active-game limit rule. This harness
closes that specific client/rules integration gap.

## Known reset blockers — explicitly excluded, not fixed

The earlier local reset proposal is frozen at `cb8b553bb09ea8bc0d2e058b4b4ccf4577cc9f97`.
Experimental commit `0d6a3c8baf6adfdbe755ebe17528c1a596ce3663` preserves failure
and concurrency evidence in a separate unpublished branch/worktree.

- Rejected reset-marker publication was caught while metadata/stats cleanup
  continued. The page falsely cleared and old retained history replayed later.
- A minimal experimental marker prerequisite passed failure/reconciliation tests,
  but a second authenticated scorer writing after the marker and before cleanup
  lost its aggregate and score while its live event survived. That deterministic
  concurrency regression remains RED. A same-client action lock is insufficient.
- Existing delegated reset UI can attempt writes forbidden by owner/admin rules.
- Existing reset cleanup still attempts an unbounded live-event read and immutable
  deletes. The separate Reset button/function remains exactly at base. The
  newly reachable preflight no longer offers Start Over or invokes reset at all.

Do not publish the experimental reset branch or claim that all tracking workflows
are safe. Reset ordering/authorization needs a separate scoped design review.
The candidate prevents the read fix from exposing destructive Cancel behavior;
it does not repair the separate Reset button or weaken its server boundaries.

## Run and CI integration

With existing Node 22 dependencies, Java 21 and Playwright Chromium:

```sh
npx firebase emulators:exec --only firestore --project demo-allplays-classic-contract \
  'npx playwright test --config playwright.rules.config.js --reporter=line'
```

Or use a running demo emulator:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8188 \
  npx playwright test --config playwright.rules.config.js --reporter=line
```

The existing reusable regression-guards workflow runs
`classic-browser-rules-contract` with SHA-pinned checkout/setup-node/setup-java,
Temurin 21, npm ci --ignore-scripts, Chromium and the emulator command above.
Permissions are contents:read only, checkout credentials are not persisted, and
there are no secrets, OIDC, deployment credentials or added PR triggers.
The required preview-smoke aggregate includes regression-integration for every
non-spec-only ready PR, including rules-only changes. The classifier marks only
spec/*.md as spec-only; rules, HTML, JS and these tests/configs take the code lane.
Missing/nonloopback emulator fails rather than silently skipping.

Production validation reuse explicitly requires this exact-head job to have
passed. If reusable PR evidence is missing, the credential-free deploy-prod
regression job runs the identical emulator command before the existing production
validation gate. No protection, rule or credential boundary is weakened.

## Local validation

Before either runtime fix: fresh Start Timer and all three stat-sheet role reads
failed under actual rules (4 failures). The exact pre-4b03 unbounded shared helper
also failed the initial 41-event page boot regression in the earlier proof.
A delegated Cancel regression against `303b69d11` then proved the newly reachable
Start Over branch published reset/clock events and changed state. It fails before
the Resume-or-Cancel guard. A genuinely empty owner game also fails against the
original production HTML, proving the query issue did not depend on fixture data.
The guarded candidate passes 23 browser/rules tests, 45 focused unit tests and 19
existing tracker smoke tests, plus cache-bust guard and diff whitespace checks.
The protected PR/deployment workflows record the rollout checks separately;
local results are not substituted for those required checks.
