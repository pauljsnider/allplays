# Repository Guidelines

## Project Structure & Module Organization
- Root HTML pages (e.g., `index.html`, `dashboard.html`, `track.html`) are entry points for screens and flows.
- Shared frontend logic lives in `js/` as ES modules (e.g., `js/auth.js`, `js/db.js`, `js/utils.js`).
- Global styling is in `css/`, images and logos in `img/`.
- The React/TypeScript app lives in `apps/app/` and is packaged for web at `/app/` plus iOS/Android through Capacitor.
- Native Capacitor shells live in `ios/` and `android/`; keep native edits thin and put shared app logic in `apps/app/src/`.
- Product specs and feature notes are kept in `spec/` and `_project-docs/`.
- Firebase configuration and rules are in `firebase.json`, `firestore.rules`, and `firestore.indexes.json`.

## Build, Test, and Development Commands
Legacy HTML site:
- `python3 -m http.server` — quick local server on port 8000.
- `npx http-server .` — alternative Node-based server.

React/Capacitor app:
- `npm run app:dev` — Vite dev server for `apps/app` on port 5174.
- `npm run app:build` — TypeScript check and Vite production build.
- `npm run mobile:sync` — build the React app and sync Capacitor assets/plugins.
- `npm run mobile:build:ios` — local iOS simulator build.
- `npm run mobile:build:android` — local Android debug build.

Open legacy pages at `http://localhost:8000`. Open the app locally at `http://localhost:5174`.

## Coding Style & Naming Conventions
- Legacy HTML/JS indentation: 4 spaces; use semicolons and ES module imports.
- React app indentation follows the existing `apps/app` TypeScript/JSX style; keep shared behavior in reusable `apps/app/src/lib` helpers.
- Naming: `camelCase` for variables/functions, `PascalCase` for classes (when used).
- Keep DOM IDs and data keys consistent with HTML names (e.g., `admin-email` ↔ `#admin-email`).
- Prefer small, focused functions in `js/` modules; reuse helpers in `js/utils.js`.
- Do not duplicate feature logic separately for web, iOS, and Android. Put app feature behavior in `apps/app/src/` and use Capacitor adapters only for native capabilities.

## Testing Guidelines

### Test suite overview
The repo has three automated test tiers:

| Tier | Framework | Location | Run command |
|------|-----------|----------|-------------|
| Legacy unit/contracts | Vitest | `tests/unit/` | `npm test` |
| React app | Vitest | `apps/app/src/` | `npm run test:app` |
| Smoke (E2E) | Playwright | `tests/smoke/` | `npm run test:smoke` |

### Unit tests (`tests/unit/`)
- Use `readFileSync` to read HTML and JS files from the repo root — no DOM or browser needed.
- Test pure logic extracted into JS modules, and assert on HTML structure/content of static pages.
- Mock Firebase and external deps with `vi.fn()` / `vi.mock()`.
- Run a single file during development: `npx vitest run tests/unit/my-file.test.js --reporter=verbose`

### React app tests (`apps/app/src/`)
- Keep React component and app unit tests colocated with app code.
- Run focused tests through the app package configuration:
  `npm run test:app -- src/path/to/file.test.tsx`.
- The app setup loads `@testing-library/jest-dom/vitest`; do not move app tests
  to root `tests/unit/` to work around missing DOM matchers.

### Smoke tests (`tests/smoke/`)
- Use Playwright against a live server (`npm run serve:firebase` or `python3 -m http.server`).
- Use `assertPageBootsWithoutFatalErrors` from `helpers/boot-path.js` for standard boot checks.
- Register new public pages in `tests/smoke/page-registry.js` → `getPublicSmokePages()`.
- Write a dedicated spec file (e.g., `tests/smoke/changelog.spec.js`) for interactive behaviors — search, filters, modals, toggles.

### What to write for each change
- **New JS module:** unit test covering the exported functions and error branches.
- **New React app helper:** colocated app unit test and focused Playwright smoke when it changes a user flow.
- **New static HTML page:** unit test checking structure, data attributes, JS wiring, and internal link targets; smoke test checking boot, key selectors, and interactive behaviors.
- **Bug fix:** add a regression unit test that fails before the fix and passes after.
- **UI flow change:** update or extend the relevant smoke spec.
- **Authentication redirect change:** preserve the same validated `next` destination across popup success, popup-to-redirect fallback, redirect completion, email sign-in, native sign-in, and new-user verification handoff. Add an auth-flow regression for each changed completion path; testing only the popup result does not cover browsers that require a full-page redirect.
- **ES module import change:** update every browser smoke stub for that module with the same named-export surface, and run the affected smoke command locally. Put the collected `pageerror` assertion before UI assertions so a missing export reports the actual module error.
- **Provider-backed mutation:** reserve ownership durably before creating an external object or capability, persist and reuse the exact provider request parameters (including generated capabilities and URLs) with a stable idempotency key, validate the provider response, and compensate only after local persistence is definitively absent. Keep both in-progress and successful active-session state—including exact requests, idempotency keys, payer identity, customer data, authorization tokens, capability hashes, checkout URLs, and provider session IDs—in server-private documents for the full attempt lifecycle. Parent/member/manager-readable records may contain generic status plus opaque reservation state only, and clients must call the server to resolve the current principal's checkout rather than navigating a stored record URL. An operator or manager must never create a payer-bound provider session and then copy/share that URL for a family or other principal; share a non-bearer sign-in deep link that lets the authorized recipient create or resolve a checkout under their own identity, or use a recipient-specific server capability that cannot inherit the operator's identity. Scope the reservation to the shared external effect: a team/season entitlement must serialize every authorized purchaser, not just repeated calls by one user. Persist the initiating principal and never replay or return that principal's provider request, customer data, capability, or checkout URL to a different principal; cross-principal retries fail closed until the first attempt is definitively completed or released. Reuse must validate and replay the exact stored private request—including any capability derived under an older signing key—rather than regenerate it from current secrets; include a secret-rotation regression around uncertain provider responses. A timeout/error after a Firestore transaction may be a committed write: re-read authoritative state before expiring a session, releasing capacity, or deleting an upload. A persistence helper returning `false` is a failed write, not success: reconcile it exactly like a thrown error, and never return a provider URL unless authoritative state proves that exact session committed. Add tests for concurrent same-principal and different-principal calls, operator-to-recipient share flows, provider success followed by pre-commit failure, post-commit response failure, false persistence results, uncertain provider responses, denial of client reads for attempt documents, and absence of bearer/session fields on readable parent records.
- **Sensitive-state relocation:** inventory historical documents before removing a readable secret, bearer URL, session ID, payer identity, or exact provider request from a schema. Search repository-wide for every collection, read model, nested reminder/retry field, and legacy alias that stores the same class of state; a backfill for one product or document type does not cover another. Derive the migration detector, private-state copy, and scrub set from the complete production read-model alias set, including the reader's sanitizer/private-field constants and every named object or array container it traverses. Add table-driven regressions with each flat alias, nested-object alias, and array-entry alias as the only historical private state; prove detection, private copy, and scrub each run so a top-level spelling table cannot hide omitted containers. Lazy migration on the next client call is insufficient because an already-issued capability may finish without another call. Deploy every producer and webhook consumer that understands the private replacement first, then run an idempotent transactional production backfill in the same fail-closed release before publishing the remaining application. Test legacy webhook completion, private-state precedence, complete flat-and-nested readable-field scrubbing, dry-run behavior, and deploy ordering for every affected schema.
- **Payment destination change:** accept only canonical HTTPS provider URLs at both stored-data and fresh-response boundaries. Never navigate to or persist an unvalidated destination.
- **Image upload change:** web, iOS, and Android must use the same authenticated project, scoped object path, content constraints, and rollback policy. Inventory every production caller of the changed upload helper and update each distinct persistence surface; before declaring the inventory complete, search all file inputs, native camera acquisition, direct `uploadBytes`/resumable calls, and `imageStorage` imports, including certificate assets and signatures—not only profile-photo helpers. Treat signer images stored in shared team defaults as team-owned objects: team-scope their paths and allow every authorized team admin to replace and delete them, never only the uploader. For legacy uploader-scoped signer references, migrate them or queue deletion only through a server-only defaults writer that proves the canonical bucket/path/generation belongs to the target team and signer field through server-owned inventory; uploader identity and current team membership alone never establish ownership. Never broaden client delete access to unrelated legacy objects. Inventory historical URL-only signer schemas too: derive a cleanup target only from the exact configured legacy bucket, require the URL token to match authoritative object metadata, resolve an unambiguous Firebase Auth uploader who is still an authorized team manager, reject newly injected legacy URLs, and retain the Storage object whenever team-bound provenance cannot be proven. A cleanup queue must be a persistent tombstone: atomically retire the canonical path with the owning-record update, reject stale attempts to re-reference every URL alias of it, and re-read the authoritative owning record plus downstream saved outputs immediately before deletion so a referenced object is never removed. Do not infer that fixing one editor fixes legacy web, React web, roster creation, parent editing, staff editing, certificates, iOS, or Android. A retained legacy secondary image bucket is optional only: no production upload may hard-require its anonymous auth; failure to initialize or authorize it must fall back to the signed-in primary project before upload, and a regression test must reject secondary auth while proving the primary scoped write. Firebase download URLs expose the encoded object path, so a public team/player image path must be resource-scoped and must not embed the uploader UID or another private identifier; enforce upload/delete authorization in Storage rules instead. Every upload helper must return both the display URL and exact cleanup path, and every adapter, native wrapper, normalizer, persisted nested object, and test mock must preserve that object—never narrow it back to a URL string or retain a compatibility branch that accepts a string-only success. The low-level transport must reserve a collision-resistant per-attempt cleanup path locally before issuing the upload request and compensate that exact candidate after a rejected, lost, or timed-out response; timestamp-only paths are not unique enough because one failed concurrent attempt could delete another attempt's successful object. Add a same-owner, same-millisecond concurrent success/failure regression proving cleanup touches only the failed attempt. Do not rely on a caller receiving the upload result to discover the candidate path. Persist the public URL and private cleanup path atomically, keep cleanup paths out of anonymously readable documents, and re-read authoritative public/private state after every ambiguous write. A failed read of the previous cleanup path is `unknown`, never proof that the path is empty; this includes the initial profile/owner read, so keep image controls disabled, omit image fields from unrelated text-only saves, and abort replacement/removal before upload until ownership loads authoritatively. Reconcile a removal after an ambiguous write even though it has no new upload path; delete the previous image only when authoritative state proves the empty path committed, retain it when the old path remains, and preserve it when state is unknown. Delete the previous image only when the new path is proven referenced; delete the new upload only when authoritative state proves it is unreferenced; preserve both when commit state remains unknown. A reserved final ID is not an owner: validate every fallible local input—including MIME type, nonzero size, byte limit, and required metadata—before creating that durable owner, then create it before starting a permanent final-path upload. Do not upload after an ambiguous owner-create response unless an authoritative re-read confirms that document exists. A temporary path must never become a permanent team/player reference: create the owning document first or atomically finalize/migrate the upload, persist the object path for authorized replacement cleanup, and prove account deletion cannot remove shared-resource photos. Pair explicit validation-before-owner and write-before-upload call-order tests on web and native with path-builder tests and Storage and Firestore rules-engine tests for creation, private cleanup-path access, another authorized admin's replacement, deletion, denied cross-resource paths, rejected/lost/timed-out upload responses, failed initial ownership reads, and committed/not-committed/unknown persistence outcomes; a mocked successful upload alone is not regression coverage—its return value must include a path and the test must assert committed/not-committed/unknown cleanup behavior.
- **Shared image retirement:** before deleting an image removed from current defaults, inventory and authoritatively check every persisted consumer that can still render it, including saved certificate documents and certificate-batch snapshots. A defaults-only reference check is insufficient; retain the object while any saved output still points to it. Canonicalize the Storage identity to bucket, decoded object path, and immutable generation. A legacy URL-only object may be deleted only when server-owned inventory binds that exact identity to the target team and signer field; uploader identity and current team membership alone are insufficient. Serialize downstream writers with retirement: atomically record a durable retired-object deny-list with the owning-record change; require every new or changed signer snapshot to carry a canonical team-scoped path and match an exact current server-owned defaults URL/path pair, so a retired URL cannot be paired with a forged live path; reject every URL/token/encoding alias of a retired path; and allow an unrelated edit to an existing historical output only when its signature URL and path remain byte-for-byte unchanged. Add real Firestore Rules race regressions for both interleavings: a stale save after retirement must fail, while a save landing after the initial scan but before retirement must remain visible to the worker's final authoritative re-read and retain the object. Whenever any producer changes a cleanup tombstone target, bucket, or payload schema, deploy a backward-compatible worker that accepts both old and new formats before that producer, independently of any Rules migration.
- **Legacy shared-module change:** when `js/db.js`, `js/auth.js`, or `js/utils.js` changes, increment that module's shared numeric `?v=` key across every production HTML, `js/`, and generator consumer. Follow the full transitive chain (for example `db.js` → `auth.js` → `utils.js` → pages), because changing only the direct import leaves cached wrappers on stale dependencies. Run `node scripts/check-critical-cache-bust.mjs`; changing one import is not sufficient.
- **Multi-stage save:** preserve the failing stage in user-visible errors and tests. Do not report a Storage authorization failure as a Firestore/profile-save failure, or vice versa.

### Manual test pages (legacy)
HTML test pages in the repo root (`test-foul-tracking.html`, `test-pr-changes.html`, etc.) remain valid for quick visual checks. `PR-TESTING-GUIDE.md` and `FOUL-TRACKING-TEST-GUIDE.md` cover critical manual flows not yet covered by automation.

## Commit & Pull Request Guidelines
- Recent commit messages are short, imperative, and sentence-case (e.g., “Fix bugs found in code review”).
- Automation may open a draft PR early for visibility, but it must not mark the
  PR ready until the exact pushed head has passed the producer preflight: the
  worktree is clean, required focused tests have passed, the PR scope/body are
  complete, and no follow-up commit is still being written.
- Treat “ready for review” as the controller handoff event. After marking a PR
  ready, do not amend or force-push that head; push a new commit when a fix is
  needed so CI and PaulBot can bind every decision to an observable SHA.
- Report draft age separately from landing age. Landing latency starts at the
  latest ready exact head, not when the early draft was opened.
- PRs should include:
  - What changed and why (bullet summary).
  - Manual test steps executed, with affected pages (e.g., `edit-schedule.html`, `login.html`).
  - Screenshots or short clips for UI changes when relevant.

## Production Handoff

- A merged PR is not a completed production change. Confirm the exact merge SHA has a successful `deploy-prod` run, exact-SHA release marker, and successful `post-deploy-smoke` before reporting it as deployed.
- If the latest `master` deployment failed or is incomplete, treat `master` as undeployed. Do not merge another dependent PR to trigger a retry; diagnose or repair the failed release first.
- Firestore rule changes require rules-engine regression coverage and must remain coupled to the Functions/Hosting code that depends on them. A failed rules activation must leave application publishing blocked.
- When a rule removes a client write path in favor of a callable, use a compatibility rollout: deploy the callable first, keep a narrowly generated transitional rule while updated callers publish, then activate the exact server-only rule. Packaged Capacitor callers do not update with Hosting; retain compatibility until an explicit protected gate proves every supported installed native version uses the callable. Classify the active rules against exact current and deployed-baseline final/compatibility sources, preserve an established final boundary even if the gate is later unset, and block rather than reopen permissions whenever the Rules API is unreadable or the active source is unrecognized. Rebuild a historical baseline variant only from an isolated checkout of that exact baseline SHA using its complete generation pipeline, including generator, transformers, compactors, helper modules, configuration, dependency lock, and compatible runtime; only a retained exact deployed artifact is an acceptable substitute. Current-workspace code or dependencies must never establish historical deployment provenance. A SHA does not identify a same-commit deployment retry: bind component markers to their workflow run ID, compare them with the latest prior production run of any conclusion (excluding the current run), and treat a different or missing identity as ambiguous until live exact-source classification resolves it. A successful run-history query with no prior run still has a missing identity and must not make an older marker trustworthy; paginate the complete durable component-deployment history past incomplete or inactive records, retain a valid component baseline for live classification when successful workflow history has expired or its commit is unavailable, and always classify identical pre-migration writable final/compatibility candidates as compatibility. Test deploy order and partial failure at every boundary.
- For Stripe or another external side effect followed by Firestore persistence, require explicit reservation, exact request replay, idempotency, response validation, authoritative post-error re-read, rollback only for a definitive non-commit, and concurrency evidence in the PR.

## Security & Configuration Tips
- Admin access is controlled by the `isAdmin` field in Firestore; don’t bypass it client-side.
- Update Firebase web config in `js/firebase.js` and `js/firebase-images.js` when changing projects.
- Ensure Auth authorized domains include local dev and the deployed host.
- Public Firebase config in app/native bundles is expected; do not commit service account keys, private API keys, provisioning profiles, or signing certificates.
- Pull-request CI has two code-head entrypoints: `pr-fast` for unit and app
  quality checks, and `pr-integration` for reusable regression, native, preview
  smoke work. Draft heads intentionally skip heavy jobs; `ready_for_review`
  starts exact-head validation. Preserve the stable
  `unit-tests`, `cache-bust-guard`, `app-quality`, `mobile-build`, and
  `preview-smoke` contexts.
- `external-claim` is ownership metadata and must not trigger or restart CI.
  Legacy workflow files are reusable/manual only; do not restore competing
  pull-request or master-push triggers.
- GitHub Pages publication is serialized behind the exact-SHA production
  release in `.github/workflows/deploy-prod.yml`.
  `.github/workflows/app-github-pages.yml` is manual validation only.
- Keep the untrusted reusable `deploy-preview.yml` builder separate from the
  default-branch `deploy-preview-trusted.yml` OIDC workflow. The trusted
  verifier accepts only an explicit `pr-preview` dispatch containing a ready
  same-repository PR number and its exact current head SHA after that head has
  passed `pr-integration`. Normal PR pushes and labels must not deploy Firebase
  preview channels.
