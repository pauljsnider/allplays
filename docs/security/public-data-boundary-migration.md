# Public data boundary migration

## Scope and invariant

This migration removes anonymous reads of canonical team, game, and shared-game
documents without removing a supported user workflow. Public pages receive
allowlisted projections from Cloud Functions. Signed-in managers, parents,
officials, and scoped helpers continue to use canonical Firestore documents.

The review and implementation baseline is
`89bc9e0b15ee664772a9acdbd5e54db0f2e8a239`.

## Impact analysis

| Workflow | Previous read/write path | New path | Compatibility protection |
| --- | --- | --- | --- |
| Browse public teams | Anonymous `teams` query | `listPublicTeams` callable | Stable pagination; location fields retained; private contact/admin fields never serialized |
| Open a public team | Anonymous canonical team get | `getPublicTeamProfile` callable after a denied canonical get | Existing authorized users still receive the complete canonical document; the public projection retains validated league/stream links, a calendar-source presence flag, and bounded standings/tournament configuration without permissions, contacts, registration internals, calendar feed credentials, or override audit identities |
| Public external calendar | Browser fetch of a raw team calendar URL | `getPublicTeamCalendarProjection` fetches the feed server-side and returns bounded event presentation fields | Public game/practice display remains available; feed URLs, query credentials, descriptions, child data, and source metadata never reach the browser |
| Public schedule and game detail | Anonymous canonical game reads | `getPublicTeamGamesProjection` / `getPublicGameProjection` | Existing shapes are mapped back to dates, scores, opponent, location, status, summary, video, tournament grouping, public imagery, stat-sheet imagery, and bounded numeric opponent stats; public schedule fallback covers a bounded nine-year window, and individually shareable game reports remain available even when the parent team is private/inactive; notes, contacts, assignments, and arbitrary metadata are removed |
| Public live game | Canonical game plus live subcollections | Sanitized projected game plus intentionally public live/event/stat subcollections | Subscription falls back to bounded 15-second projection polling and is stopped by unsubscribe |
| Manager and parent schedule | Canonical team/game reads | Unchanged | Emulator coverage proves owner/admin and linked-parent reads |
| Scorekeeper, videographer, streamer, media helper | Canonical scoped reads/writes | Unchanged | Team/game helper grants are explicit and emulator-tested |
| Assigned official | Broad team game read | Queries constrained by authorized UID/email | Both UID and normalized-email assignment forms are covered |
| Public RSVP open/submit | Bearer in query string; repeat submissions queued repeat work | Query token captured and removed before external requests, POST body for new clients, token-first rate limiting, atomic replay detection | During the mixed-version window, email links remain query-based and `getPublicRsvp` accepts legacy GET plus new POST; same-response retry is a no-op; transaction scope is revalidated and durable rate-limit rows have TTL |
| Family share | Bearer in query string | Fragment for newly created legacy links; query links consumed and removed | Existing query links remain readable during transition |
| Native authentication | WebView-persisted Firebase REST tokens | Native Firebase Authentication owns durable credentials; WebView stores metadata only | An already-loaded legacy session is held only in memory for the current run and is scrubbed from durable WebView stores |
| Native profile photo upload | Persisted anonymous token for the separate image Firebase project | One anonymous image-project token minted in memory per upload and deleted after the request | Preserves the existing cross-project Storage authorization without durable WebView credentials or retained anonymous upload accounts |
| Public homepage games | Missing collection-group single-field index | Explicit `sharedGames.liveStatus` index override | Deploy index and wait for readiness before relying on the query |

## Passive rollout order

The order matters. Rules are last so old clients retain a working read path until
the projections are live.

1. Deploy `firestore.indexes.json` and wait for the `sharedGames.liveStatus`
   collection-group index to report `READY`.
2. Deploy Functions containing team/game projections and the hardened RSVP
   handlers. Keep legacy `GET getPublicRsvp?token=...` enabled and continue
   generating query-token email links during this compatibility window.
3. Deploy web/app clients and verify both the previously deployed query/GET
   RSVP page and the new query-or-fragment/POST page, plus public browse, team
   detail, schedule, live game, RSVP, family share, manager, parent, helper, and
   official workflows.
4. Deploy Firestore rules.
5. Observe permission-denied rate, projection error rate, RSVP 429 rate,
   Functions latency/errors, and support reports through at least one normal
   game-day cycle.
6. Move the apex host to Firebase Hosting only as a separate operational change.
   Do not enforce App Check until supported client coverage has been measured.

After the new page has been established through the observation window and
cached legacy HTML is no longer supported, switch newly generated email links
to fragments first. Remove the GET compatibility handler only in a later
release after query-link traffic has drained.

## Rollback

- A rules regression is recovered by restoring the previous rules only; do not
  roll back projections first.
- A projection regression is recovered by keeping the new Functions and
  restoring the previous rules while the client/serializer is repaired.
- RSVP query links remain compatible with both deployed page versions and the
  hardened handlers. The new page removes the query before loading third-party
  resources, so no token rewrite is required during rollback.
- Native users signed in after this release use Keychain/Keystore-backed Firebase
  state. Users whose only credential was a WebView REST session may need to sign
  in once after a cold app restart; secrets are deliberately not re-persisted.

## Residual and operational items

- The current apex GitHub Pages response cannot supply the Firebase Hosting
  security headers. Header policy exists in `firebase.json`; DNS/hosting cutover
  is an operational action and is not part of this code change.
- The SPA uses React Router only in client HashRouter mode. The remaining npm
  advisory applies to React Server Components, which are not built or served by
  this repository.
- The newest release line compatible with both the namespace-based Admin API and
  the first-generation `functions.runWith` API used here still resolves
  transitive Google packages with upstream moderate audit advisories. Firebase
  Admin 14 removes the namespace API and Firebase Functions 6 removes this
  `runWith` entry point; either upgrade fails at process startup. Forcing those
  majors or incompatible transitive overrides would create a higher
  Firestore/Storage regression risk. Track upstream releases and plan the
  modular Functions migration separately.
- Safe root lockfile updates were applied for Firebase CLI, MCP/Hono, archive,
  URI, XML, WebSocket, and brace-expansion packages. The remaining root audit
  findings are confined to development tooling inherited through Firebase CLI,
  plus the client-only React Router advisory described above; the production
  root dependency audit is clean. npm's remaining suggested remediation is a
  forced Firebase CLI downgrade, which is not a passive security fix and was
  not applied.
- Global removal of `unsafe-inline` from the legacy Content Security Policy is
  intentionally staged separately because legacy pages still contain inline
  scripts. Bearer pages instead remove third-party telemetry and use
  `no-referrer`/`no-store` now.
