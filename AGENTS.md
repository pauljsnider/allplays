# ALL PLAYS Repository Instructions

This file is the canonical shared instruction set for coding agents in this
repository. `CLAUDE.md` imports it, Amazon Q adds reviewer-only rules in
`.amazonq/rules/allplays.md`, and narrower `AGENTS.md` files add directory
specifics. Architecture and CI evidence live in `docs/codebase/`.

## Product and Architecture

ALL PLAYS is a sports team-management and live-stat-tracking product with four
active runtime surfaces:

- Root `*.html`, `js/`, `css/`, and `img/`: the legacy static web product.
- `apps/app/`: the React/TypeScript app, hosted at `/app/` and packaged for iOS
  and Android through Capacitor.
- `functions/`: deployed Firebase Functions on Node 20.
- `services/chatgpt-mcp/`: a read-only, user-credentialed Node 22 MCP service.

The main Firebase project, `game-flow-c6311`, owns Auth, Firestore, Functions,
and Hosting. `game-flow-img` isolates image uploads. Firestore and Storage rules
are authorization boundaries, not optional client-side validation.

Read the relevant reference before a broad change:

- `docs/codebase/STACK.md`: runtimes, dependencies, commands, and config.
- `docs/codebase/STRUCTURE.md`: source boundaries and active entry points.
- `docs/codebase/ARCHITECTURE.md`: data flow and module responsibilities.
- `docs/codebase/CONVENTIONS.md`: code, errors, logging, and test conventions.
- `docs/codebase/INTEGRATIONS.md`: Firebase, Stripe, Resend, MCP, native, and CI.
- `docs/codebase/TESTING.md`: local test matrix and the complete CI/deploy graph.
- `docs/codebase/CONCERNS.md`: fragile areas and known architecture risks.
- `docs/landing-process.md`: external ownership and PaulBot landing handoff.

## Source Ownership

- Put legacy shared behavior in small ES modules under `js/`; reuse `js/utils.js`
  and existing Firebase helpers instead of copying page-local implementations.
- Put React routes in `apps/app/src/pages`, reusable UI in `components`, and
  business/data behavior in `apps/app/src/lib`.
- Keep web, iOS, and Android feature behavior shared. Native shells in `ios/`
  and `android/` should contain only platform configuration or thin adapters.
- Treat adapters in `apps/app/src/lib/adapters` as the compatibility boundary
  to legacy code. Search both the adapter and its legacy consumer before
  changing a shared payload or return type.
- Put deployed backend changes in `functions/`, whose active entry point is
  `functions/index.js`. Do not create an alternate Functions source tree.
- Put ChatGPT MCP work in `services/chatgpt-mcp/`. Application reads must remain
  user-credentialed and rules-enforced; the service identity is only for the
  isolated OAuth grant store.
- `_migration/` scripts are one-off privileged operations. Never run one against
  a real project without explicit authorization and a verified project target.
- `docs/pr-notes/runs/` is generated historical evidence. Do not scan or edit it
  unless the task specifically concerns a recorded automation run.

## Runtime and Package Manager

- Use Node 22 and npm 10+ for the root, React app, and MCP service. Firebase
  Functions deploy on Node 20.
- npm and `package-lock.json` are canonical in CI. Use `npm ci` for clean
  installs and `npm --prefix <directory> ...` for nested packages.
- Do not introduce a pnpm/Yarn lockfile or package-manager workspace.
  Dependency changes must update the applicable `package.json` and
  `package-lock.json` together.
- Do not hand-edit generated bundles, `node_modules`, Capacitor generated files,
  Playwright output, or `apps/app/bundle-visualizer.html`.

## Development Commands

```bash
# Install the same package sets CI uses
npm ci
npm ci --prefix apps/app
npm ci --prefix functions

# Legacy site and React app
python3 -m http.server 8000
npm run app:dev
npm run app:build

# Root unit/rules tests and React app tests
npm test
npm run test:unit:ci
npm --prefix apps/app run test:ci

# Focused examples
npx vitest run tests/unit/my-feature.test.js --reporter=verbose
npm --prefix apps/app exec -- vitest run src/lib/my-feature.test.ts --reporter=verbose
npm run test:smoke:team-fallback

# Native validation
npm run mobile:sync
npm run mobile:build:android
npm run mobile:build:ios
```

The legacy server defaults to `http://localhost:8000`; the app dev server uses
`http://localhost:5174`. Playwright defaults to a staged server at
`http://127.0.0.1:4173` and accepts `SMOKE_BASE_URL` and
`SMOKE_APP_BASE_URL` overrides.

## Change and Test Contract

Before editing, search producers, consumers, tests, rules, and deploy scripts
for the symbol, field, DOM ID, route, or config key being changed. This repo has
legacy and React implementations of many workflows; a change is incomplete if
only one active consumer understands the new contract.

| Change | Minimum focused validation |
| --- | --- |
| Legacy JS or static HTML | Root Vitest regression; smoke test for changed interaction or boot path |
| React helper/component/route | Co-located `apps/app/src/**/*.test.ts(x)`, app typecheck/build, focused app smoke for a user flow |
| Shared legacy/React contract | Tests for both producer and all active consumers |
| Firestore/Storage rules | Relevant emulator-backed rule test plus `npm run ci:firebase-rules` |
| Firebase Functions | Relevant `functions/test` suite; run auth, team-email, or notification command when touched |
| Runtime config/App Check | Config resolver tests, app build, and staged artifact/boot validation |
| Native plugin/config | App build, `npx cap sync`, and applicable native debug build |
| GitHub workflow/deploy script | YAML/shell syntax, referenced script tests, permissions/trust review, and exact path-filter behavior |
| Bug fix | A regression test that fails before the fix and passes after |

Use `readFileSync` contract tests for static pages when a browser is unnecessary.
Use `assertPageBootsWithoutFatalErrors` and the registry in
`tests/smoke/page-registry.js` for public legacy pages. Keep manual evidence in
the PR body when an interaction is not automated.

There is no repository-wide numeric coverage threshold. Do not claim coverage
completeness from a green run; use `npm run test:coverage-map` to check the
curated feature map and add focused regressions for changed behavior.

## Coding Conventions

- Legacy HTML/JS uses four-space indentation, semicolons, ES module imports,
  `camelCase` functions/variables, and DOM IDs aligned with field names.
- React/TypeScript follows `apps/app/.prettierrc.json`, strict TypeScript, and
  `apps/app/eslint.config.js`. Run the nested formatter/linter; there is no
  root-wide formatter that may rewrite the legacy site safely.
- Reuse `apps/app/src/lib/logger.ts` for app logging. It redacts tokens, keys,
  passwords, cookies, and email addresses. Never add raw credentials or
  personally identifiable data to logs, test artifacts, or PR comments.
- Normalize app service failures with `AppServiceError` helpers where the
  surrounding service already uses them; preserve user-safe messages and error
  causes for telemetry.
- Preserve critical legacy cache-bust query strings when changing imported
  assets; `scripts/check-critical-cache-bust.mjs` enforces selected updates.
- Prefer small, focused functions and PRs. Pull requests should normally stay
  below 500 changed lines and 20 files; explain or split larger changes.

## CI Flow

PR validation is intentionally split. Diagnose the failing stage instead of
restarting every run:

1. `ci.yml`: cache-bust guard, root/rules/function tests, app audit, typecheck,
   diff-aware lint, and app tests.
2. `regression-guards.yml`: Firebase deploy/rules guard and focused
   roster/chat/media/replay Playwright smoke.
3. `mobile-build.yml`: path-filtered Android and iOS builds, summarized by the
   stable fail-closed `mobile-build` context.
4. `preview-smoke.yml`: path-filtered staged web/app smoke and visual tests,
   summarized by the stable fail-closed `preview-smoke` context.
5. `deploy-preview.yml` creates an untrusted, credential-free PR artifact.
   `deploy-preview-trusted.yml` verifies the run, PR, artifact, and current head
   from trusted default-branch code before OIDC and Firebase preview deployment.
6. `app-github-pages.yml` validates the staged web bundle on PRs; deployment is
   disabled unless the repository variable or manual input explicitly enables it.

After merge, `deploy-prod.yml` retests and builds a commit-bound artifact, then
obtains production credentials only in the protected deploy job. It deploys
changed rules/indexes before application components and fails closed.
`post-deploy-smoke.yml`, `scheduled-prod-smoke.yml`,
`critical-workflow-health.yml`, and `firestore-recovery-health.yml` monitor the
result.

Do not merge the untrusted and trusted preview workflows, add OIDC or secrets to
PR-code jobs, execute downloaded artifact code in a privileged job, loosen
exact-SHA checks, or replace SHA-pinned third-party actions with mutable tags.
These are security boundaries, not workflow ceremony.

Canceled runs on an obsolete SHA are expected. Always bind review, checks, and
remediation to the current PR head. A green result for an older commit is not
evidence for a newer one.

## External Ownership and PaulBot Handoff

PaulBot is the landing controller; coding sessions are producers.
Treat “ready for review” as the controller handoff event.
Landing latency starts at the latest ready exact head, not when an early draft
was opened.

1. Add `external-claim` to both the issue and PR before an outside human, Codex,
   Claude, or Q session starts writing.
2. Keep the PR draft and keep `external-claim` while commits or review fixes are
   still being produced.
3. Before handoff, make the worktree clean, run focused validation, finish the
   PR title/body/evidence, push the final commit, and verify the exact remote
   head SHA.
4. Mark ready and remove `external-claim` only when that exact head is frozen.
   This is the controller handoff and the start of landing latency.
5. After handoff, do not push, amend, force-push, rebase, merge, toggle
   auto-merge, or launch a competing remediation session. PaulBot owns review,
   branch update, required checks, and merge.
6. Before handoff, the current producer may restore `external-claim` when code
   must change, then make a new commit, rerun focused validation, and perform a
   new exact-head handoff. After handoff, an external coding session must not
   restore the label or reclaim remediation merely because PaulBot found an
   issue. Only an explicit operator-requested ownership transfer may return the
   PR to an external producer; otherwise PaulBot remains the sole writer.

`external-claim` is controller ownership metadata, not a CI trigger. PR
workflows run on code-head lifecycle events and must not restart or cancel for
label churn. At handoff PaulBot consumes the frozen exact head's existing
results; if applicable current-head checks are missing or canceled, the
controller narrowly wakes or reruns them.

Amazon Q review is also commit-specific. A subsequent push does not
automatically repeat Q's GitHub review; request `/q review` on the new frozen
head when Q is part of the landing policy.

## Commit, PR, and Security Requirements

- Use short, imperative, sentence-case commits. Do not amend a handed-off head.
- PR bodies need a change/why summary, tests actually run, affected pages or
  routes, manual steps, and screenshots/clips for visible UI changes.
- Report draft age separately from landing age; do not describe draft
  development time as merge-controller latency.
- Never commit service-account keys, private API keys, Stripe/Resend secrets,
  OAuth encryption keys, signing certificates, provisioning profiles, or
  keystores. Public Firebase client config is expected.
- Never bypass `isAdmin`, team ownership/admin, parent, verified-email,
  entitlement, or App Check policy in client code.
- Use the root `firebase.json`, `firestore.rules`, `firestore.indexes.json`, and
  `storage.rules` as the only deployment configuration.
- Direct production deploys, migrations, issue/PR mutations, ready-state
  changes, and merges require the explicit workflow or ownership authorization
  described above.

## Detailed Regression Safety Requirements

These requirements preserve the tested safety boundaries alongside the concise workflow above.

- **Provider-backed mutation:** reserve ownership durably before creating an external object or capability, persist and reuse the exact provider request parameters (including generated capabilities and URLs) with a stable idempotency key, validate the provider response, and compensate only after local persistence is definitively absent. Keep both in-progress and successful active-session state—including exact requests, idempotency keys, payer identity, customer data, authorization tokens, capability hashes, checkout URLs, and provider session IDs—in server-private documents for the full attempt lifecycle. Parent/member/manager-readable records may contain generic status plus opaque reservation state only, and clients must call the server to resolve the current principal's checkout rather than navigating a stored record URL. An operator or manager must never create a payer-bound provider session and then copy/share that URL for a family or other principal; share a non-bearer sign-in deep link that lets the authorized recipient create or resolve a checkout under their own identity, or use a recipient-specific server capability that cannot inherit the operator's identity. Scope the reservation to the shared external effect: a team/season entitlement must serialize every authorized purchaser, not just repeated calls by one user. Persist the initiating principal and never replay or return that principal's provider request, customer data, capability, or checkout URL to a different principal; cross-principal retries fail closed until the first attempt is definitively completed or released. Reuse must validate and replay the exact stored private request—including any capability derived under an older signing key—rather than regenerate it from current secrets; include a secret-rotation regression around uncertain provider responses. A timeout/error after a Firestore transaction may be a committed write: re-read authoritative state before expiring a session, releasing capacity, or deleting an upload. A persistence helper returning `false` is a failed write, not success: reconcile it exactly like a thrown error, and never return a provider URL unless authoritative state proves that exact session committed. Add tests for concurrent same-principal and different-principal calls, operator-to-recipient share flows, provider success followed by pre-commit failure, post-commit response failure, false persistence results, uncertain provider responses, denial of client reads for attempt documents, and absence of bearer/session fields on readable parent records.

- **Sensitive-state relocation:** inventory historical documents before removing a readable secret, bearer URL, session ID, payer identity, or exact provider request from a schema. Search repository-wide for every collection, read model, nested reminder/retry field, and legacy alias that stores the same class of state; a backfill for one product or document type does not cover another. Derive the migration detector, private-state copy, and scrub set from the complete production read-model alias set, including the reader's sanitizer/private-field constants and every named object or array container it traverses. Add table-driven regressions with each flat alias, nested-object alias, and array-entry alias as the only historical private state; prove detection, private copy, and scrub each run so a top-level spelling table cannot hide omitted containers. Lazy migration on the next client call is insufficient because an already-issued capability may finish without another call. Deploy every producer and webhook consumer that understands the private replacement first, then run an idempotent transactional production backfill in the same fail-closed release before publishing the remaining application. Test legacy webhook completion, private-state precedence, complete flat-and-nested readable-field scrubbing, dry-run behavior, and deploy ordering for every affected schema.

- **Image upload change:** web, iOS, and Android must use the same authenticated project, scoped object path, content constraints, and rollback policy. Inventory every production caller of the changed upload helper and update each distinct persistence surface; before declaring the inventory complete, search all file inputs, native camera acquisition, direct `uploadBytes`/resumable calls, and `imageStorage` imports, including certificate assets and signatures—not only profile-photo helpers. Treat signer images stored in shared team defaults as team-owned objects: team-scope their paths and allow every authorized team admin to replace and delete them, never only the uploader. For legacy uploader-scoped signer references, migrate them or queue deletion only through a server-only defaults writer that proves the canonical bucket/path/generation belongs to the target team and signer field through server-owned inventory; uploader identity and current team membership alone never establish ownership. Deploy the old/new-compatible server-only inventory producer first, deploy the revalidating superset cleanup worker before any migration invalidates previously accepted bindings, backfill every authoritative active legacy reference, and only then deploy a writer that emits new tombstones. Producer-before-backfill closes the concurrent defaults-write gap; consumer-before-revocation prevents already-queued work from using stale authorization. Make the worker hydrate and safely process every old and new tombstone schema it can observe; cleanup authorization requires a nonempty canonical object key, and equality between two missing keys is never proof. An unproven legacy object is retained, not rejected as disposable. Never broaden client delete access to unrelated legacy objects. Inventory historical URL-only signer schemas too: derive a cleanup target only from the exact configured legacy bucket, require the URL token to match authoritative object metadata, resolve an unambiguous Firebase Auth uploader who is still an authorized team manager, reject newly injected legacy URLs, and retain the Storage object whenever team-bound provenance cannot be proven. A cleanup queue must be a persistent tombstone: atomically retire the canonical path with the owning-record update, reject stale attempts to re-reference every URL alias of it, and re-read the authoritative owning record plus downstream saved outputs immediately before deletion so a referenced object is never removed. Do not infer that fixing one editor fixes legacy web, React web, roster creation, parent editing, staff editing, certificates, iOS, or Android. A retained legacy secondary image bucket is optional only: no production upload may hard-require its anonymous auth; failure to initialize or authorize it must fall back to the signed-in primary project before upload, and a regression test must reject secondary auth while proving the primary scoped write. Firebase download URLs expose the encoded object path, so a public team/player image path must be resource-scoped and must not embed the uploader UID or another private identifier; enforce upload/delete authorization in Storage rules instead. Every upload helper must return both the display URL and exact cleanup path, and every adapter, native wrapper, normalizer, saved-output serializer, persisted nested object, and test mock must preserve that pair—never narrow it back to a URL string, strip the path from a certificate/batch snapshot, or retain a compatibility branch that accepts a string-only success. The low-level transport must reserve a collision-resistant per-attempt cleanup path locally before issuing the upload request and compensate that exact candidate after a rejected, lost, or timed-out response; timestamp-only paths are not unique enough because one failed concurrent attempt could delete another attempt's successful object. Every durable upload attempt token must come from `crypto.randomUUID` or `crypto.getRandomValues`; never fall back to `Math.random`, and fail closed when secure randomness is unavailable. Add a same-owner, same-millisecond concurrent success/failure regression proving cleanup touches only the failed attempt. Do not rely on a caller receiving the upload result to discover the candidate path. Persist the public URL and private cleanup path atomically, keep cleanup paths out of anonymously readable documents, and re-read authoritative public/private state after every ambiguous write. A failed read of the previous cleanup path is `unknown`, never proof that the path is empty; this includes the initial profile/owner read, so keep image controls disabled, omit image fields from unrelated text-only saves, and abort replacement/removal before upload until ownership loads authoritatively. Reconcile a removal after an ambiguous write even though it has no new upload path; delete the previous image only when authoritative state proves the empty path committed, retain it when the old path remains, and preserve it when state is unknown. Delete the previous image only when the new path is proven referenced; delete the new upload only when authoritative state proves it is unreferenced; preserve both when commit state remains unknown. A reserved final ID is not an owner: validate every fallible local input—including MIME type, nonzero size, byte limit, and required metadata—before creating that durable owner, then create it before starting a permanent final-path upload. Do not upload after an ambiguous owner-create response unless an authoritative re-read confirms that document exists. A temporary path must never become a permanent team/player reference: create the owning document first or atomically finalize/migrate the upload, persist the object path for authorized replacement cleanup, and prove account deletion cannot remove shared-resource photos. Pair explicit validation-before-owner and write-before-upload call-order tests on web and native with path-builder tests and Storage and Firestore rules-engine tests for creation, private cleanup-path access, another authorized admin's replacement, deletion, denied cross-resource paths, rejected/lost/timed-out upload responses, failed initial ownership reads, committed/not-committed/unknown persistence outcomes, preserved saved-output URL/path pairs, standalone old/new worker schemas, and producer-before-consumer-before-backfill-before-writer deployment order; a mocked successful upload alone is not regression coverage—its return value must include a path and the test must assert committed/not-committed/unknown cleanup behavior.

- **Old cleanup tombstones:** current Storage metadata cannot reconstruct a generation omitted by an old path-only tombstone. Only a generation recorded with the historical target may authorize deletion; equality between missing object keys is never proof. A proven 404 may complete as already missing, but an existing object without historical generation evidence must be retained as unverified.

- **Certificate retry evidence:** when a certificate defaults write has an ambiguous response, compare the complete normalized writable payload—not only signers—before reporting success. Certificate upload nonces must use `crypto.randomUUID` or `crypto.getRandomValues`; never fall back to `Math.random`, and fail closed when secure randomness is unavailable.

- **Shared image retirement:** before deleting an image removed from current defaults, inventory and authoritatively check every persisted consumer that can still render it, including saved certificate documents and certificate-batch snapshots. A defaults-only reference check is insufficient; retain the object while any saved output still points to it. Canonicalize the Storage identity to bucket, decoded object path, and immutable generation. A legacy URL-only object may be deleted only when server-owned inventory binds that exact identity to the target team and signer field; uploader identity and current team membership alone are insufficient. Serialize downstream writers with retirement: atomically record a durable retired-object deny-list with the owning-record change; require every new or changed signer snapshot to carry a canonical team-scoped path and match an exact current server-owned defaults URL/path pair, so a retired URL cannot be paired with a forged live path; reject every URL/token/encoding alias of a retired path; and allow an unrelated edit to an existing historical output only when its signature URL and path remain byte-for-byte unchanged. Add real Firestore Rules race regressions for both interleavings: a stale save after retirement must fail, while a save landing after the initial scan but before retirement must remain visible to the worker's final authoritative re-read and retain the object. Whenever any producer changes a cleanup tombstone target, bucket, or payload schema, deploy a backward-compatible worker that accepts both old and new formats before that producer, independently of any Rules migration.

- When a rule removes a client write path in favor of a callable, use a compatibility rollout: deploy the callable first, keep a narrowly generated transitional rule while updated callers publish, then activate the exact server-only rule. Packaged Capacitor callers do not update with Hosting; retain compatibility until an explicit protected gate proves every supported installed native version uses the callable. Classify the active rules against exact current and deployed-baseline final/compatibility sources, preserve an established final boundary even if the gate is later unset, and block rather than reopen permissions whenever the Rules API is unreadable or the active source is unrecognized. Rebuild a historical baseline variant only from an isolated checkout of that exact baseline SHA using its complete generation pipeline, including generator, transformers, compactors, helper modules, configuration, dependency lock, and compatible runtime; only a retained exact deployed artifact is an acceptable substitute. Current-workspace code or dependencies must never establish historical deployment provenance. A SHA does not identify a same-commit deployment retry: bind component markers to their workflow run ID, compare them with the latest prior production run of any conclusion (excluding the current run), and treat a different or missing identity as ambiguous until live exact-source classification resolves it. A successful run-history query with no prior run still has a missing identity and must not make an older marker trustworthy; paginate the complete durable component-deployment history past incomplete or inactive records, retain a valid component baseline for live classification when successful workflow history has expired or its commit is unavailable, and always classify identical pre-migration writable final/compatibility candidates as compatibility. Test deploy order and partial failure at every boundary.

- Keep the untrusted reusable `deploy-preview.yml` builder separate from the
  default-branch `deploy-preview-trusted.yml` OIDC workflow. The trusted
  verifier accepts only an explicit `pr-preview` dispatch containing a ready
  same-repository PR number and its exact current head SHA after that head has
  passed `pr-integration`. Normal PR pushes and labels must not deploy Firebase
  preview channels.
