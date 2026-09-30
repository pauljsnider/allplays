# External Integrations

## 1) Integration Inventory

| System | Type | Purpose | Auth model | Criticality | Evidence |
| --- | --- | --- | --- | --- | --- |
| Firebase Auth | Identity | Web/native user sessions and verified-email state | Firebase user credentials | High | `js/auth.js`, `apps/app/src/lib/authService.ts` |
| Main Firestore | Database | Teams, rosters, games, schedules, chat, practices, profiles | User SDK + `firestore.rules`; Admin SDK only in trusted Functions/migrations | High | `js/db.js`, `firestore.rules`, `functions/index.js` |
| Image Firebase project | Object storage | Team/player/media uploads isolated from main project | Firebase Auth/App Check + `storage.rules` | High | `js/firebase-images.js`, `storage.rules` |
| Firebase Functions | Serverless API/events | Email, payments, calendars, registration sync, notification jobs | Callable/HTTP auth, App Check, triggers, server secrets | High | `functions/index.js` |
| Firebase Hosting | Static hosting | Legacy root and React app under `/app/`; PR channels | GitHub OIDC only in trusted deploy jobs | High | `firebase.json`, deploy workflows |
| Stripe | Payment API/webhooks | Season Team Pass checkout and entitlements | Secret/restricted key and signed webhook | High | `functions/index.js`, `README.md` |
| Resend | Email API/webhooks | Auth, invite, team, and reminder email | Firebase secret and webhook signature | High | `functions/index.js`, `functions/package.json` |
| Sports Connect | External registration API | Registration snapshot/import workflows | Server-side API token/config | Medium | `functions/index.js` |
| Calendar/ICS sources | HTTP feeds | Import/export team and public schedules | Public or service-account mediated endpoints | Medium | `js/calendar-ics-sync.js`, `functions/index.js` |
| Sentry | Telemetry | Optional React app errors and releases | Public DSN/runtime config | Medium | `apps/app/src/lib/telemetry.ts` |
| Firebase Performance/Web Vitals | Telemetry | Startup and runtime performance signals | Firebase client config/App Check | Medium | `apps/app/src/lib/performanceInstrumentation.ts` |
| ChatGPT MCP | MCP/OAuth service | Read-only profile, schedule, and game-summary tools | OAuth bearer resolved to Firebase user; isolated encrypted grant store | High | `services/chatgpt-mcp/README.md`, `src/server.js` |
| GitHub Actions + Google Cloud | CI/CD | Tests, previews, production deploys, recovery checks | Least-privilege token permissions and workload identity OIDC | High | `.github/workflows/` |
| Apple/Google native services | Mobile platform | Sign-in, push, App Check, store releases | Platform config and protected signing/store credentials | High | `ios/`, `android/`, mobile workflows |

## 2) Data Stores

| Store | Role | Access layer | Key risk | Evidence |
| --- | --- | --- | --- | --- |
| Main Firestore `(default)` | Product source of truth | Firebase SDK, rules, Functions | Broad shared schema and large rules file; contract drift | `firestore.rules`, `js/db.js` |
| Main Firebase Storage | Product storage where configured | Firebase SDK and Storage rules | Path/privacy mistakes | `storage.rules`, `firebase.json` |
| Image-project Storage | Isolated public/media upload store | Image Firebase client and rules | Cross-project config or auth drift | `js/firebase-images.js` |
| MCP OAuth grant Firestore | Durable opaque grants and encrypted Firebase-token binding | MCP Cloud Run identity only | Must remain isolated from application default database | `services/chatgpt-mcp/src/oauthStore.js` |
| Browser/native cache | Performance and offline state | App cache/service helpers | Stale authorization-sensitive data | `apps/app/src/lib/appDataCache.ts` |

## 3) Secrets and Credentials Handling

- Public Firebase web configuration and Sentry DSNs are identifiers, not
  authorization secrets. Rules, App Check, and server policy still enforce data
  access.
- Stripe, Resend, Sports Connect, MCP encryption, service-account, mobile
  signing, and store-upload credentials must come from Firebase/Google Secret
  Manager, protected GitHub environments, or runtime environment variables.
- Production deploys use short-lived GitHub OIDC credentials. PR-controlled
  code and untrusted artifacts must never receive them.
- The MCP grant store persists only SHA-256 token digests and AES-256-GCM
  encrypted Firebase bindings. Its service account must not have privileged
  application-data access.
- The app logger redacts common credential and PII shapes, but callers remain
  responsible for passing the minimum diagnostic context.
- `[TODO]` No central credential inventory or rotation calendar is stored in
  this repo. Owning runbooks and cloud configuration are the current lifecycle
  sources.

No application message queue, service mesh, or separate API gateway was found.
Clients reach Firebase services/Functions directly, while the MCP service is an
Express HTTP process behind its deployment platform.

## 4) Reliability and Failure Behavior

- Native dependency resolution/builds retry selected transient npm, Gradle, and
  SwiftPM failures with bounded attempts in `mobile-build.yml`.
- Production deploy retries selected transient Firebase component failures, but
  fails closed when changed Firestore configuration cannot deploy.
- Preview deployment rechecks the current PR head before credential acquisition,
  deployment, and reporting; stale artifacts are not intentionally published.
- Runtime Firebase config falls back from hosted config to safe inline/bundled
  public values. App Check enforcement is staged and production artifact guards
  reject unsafe debug configuration.
- MCP grants have explicit code/access/refresh expiry and atomic one-time
  consumption/rotation; production rejects process-local memory storage.
- External integration timeout/retry behavior is not uniform across the large
  Functions entry point; inspect the owning function before adding another
  retry to avoid duplicate email, payment, or registration side effects.

## 5) Observability for Integrations

- React app errors and performance signals flow through `telemetry.ts`,
  `logger.ts`, Web Vitals, and Firebase Performance when configured.
- GitHub jobs emit summaries and upload targeted logs/diffs on smoke or native
  failures.
- Production has post-deploy smoke, 15-minute scheduled smoke, six-hour
  critical-workflow health, and six-hour Firestore recovery checks.
- Managed health workflows reconcile durable GitHub issues rather than relying
  only on transient run logs.
- Visibility gaps: no single repository dashboard covers all external API
  latency/error rates, and no repo file defines per-integration SLOs.

## 6) Evidence

- `firebase.json`
- `firestore.rules`
- `storage.rules`
- `js/firebase-runtime-config.js`
- `functions/index.js`
- `apps/app/src/lib/logger.ts`
- `apps/app/src/lib/telemetry.ts`
- `services/chatgpt-mcp/README.md`
- `.github/workflows/deploy-preview-trusted.yml`
- `.github/workflows/deploy-prod.yml`
- `.github/workflows/critical-workflow-health.yml`
