# Architecture

## 1) Architectural Style

- Primary style: a transitional multi-surface, client-first Firebase
  architecture with a layered React app and compatibility adapters to a legacy
  static application.
- Why: root pages directly use shared browser modules and Firebase, while the
  newer React app composes routes over service modules that frequently adapt
  the same legacy data layer. Server-side integrations live in Firebase
  Functions; a separate MCP service exposes a read-only user-scoped view.
- Primary constraints:
  - One feature may have legacy, React web, iOS, and Android consumers.
  - Firestore/Storage rules are the common authorization boundary.
  - Static hosting must preserve root legacy paths and a relocatable `/app/`
    bundle.
  - PR and production artifacts cross explicit untrusted/trusted CI boundaries.

## 2) System Flow

```text
browser/native route
  -> page or React route
  -> shared helper/service or legacy adapter
  -> Firebase SDK / callable Function / approved external API
  -> Firestore or Storage rules and server-side validation
  -> snapshot/result
  -> UI state, telemetry, and user-safe error
```

1. A root HTML page imports legacy modules, or `apps/app/src/main.tsx` starts the
   React app and `App.tsx` selects a route.
2. The route delegates reusable work to `js/` or `apps/app/src/lib`; React
   services may call a typed legacy adapter instead of duplicating a contract.
3. Client data calls use Firebase user credentials. Rules evaluate global
   admin, owner/admin, parent, privacy, verification, and entitlement policy.
4. Privileged integrations such as email, payments, registration sync, and
   calendar access run through `functions/index.js`.
5. Live data returns through promises or Firestore snapshot listeners and is
   normalized for UI state.
6. The app reports redacted logs/telemetry and renders loading, error, empty, or
   success states.

Firebase Auth, Firestore, and scheduled Functions provide event-driven
background work for notifications, email, cleanup, and synchronization. No
independent application message queue or worker service was found.

The MCP flow is intentionally narrower:

```text
ChatGPT OAuth bearer
  -> services/chatgpt-mcp identity resolver
  -> Firebase user token
  -> Firestore REST as that user
  -> rules-authorized, field-whitelisted response
```

The Cloud Run identity may access only the isolated durable OAuth grant store;
it must not become an application-data bypass.

## 3) Layer and Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
| --- | --- | --- | --- |
| Root HTML | Legacy page composition and DOM | Repeated shared persistence logic | `dashboard.html`, `edit-schedule.html` |
| `js/` | Legacy domain/UI helpers and Firebase client access | Server secrets or admin bypasses | `js/db.js`, `js/auth.js` |
| React pages/components | Route and view composition | Duplicated platform business logic | `apps/app/src/pages/`, `components/` |
| React `lib` services | Typed domain/data/platform behavior | Unreviewed privileged access | `apps/app/src/lib/` |
| React legacy adapters | Compatibility translation | A second independent source of business truth | `apps/app/src/lib/adapters/` |
| Firebase rules | Authorization and write validation | Presentation policy | `firestore.rules`, `storage.rules` |
| Firebase Functions | Privileged triggers, email, payments, external services | Browser-only UI state | `functions/index.js` |
| MCP service | Read-only user-scoped tools and OAuth grants | Service-credentialed app reads | `services/chatgpt-mcp/src/` |
| Staging scripts | Reproducible static/deploy artifacts | Production credential acquisition | `scripts/stage-pages-bundle.mjs` |
| Trusted deploy jobs | Artifact verification, OIDC, exact-target deploy | Execution of untrusted PR code | Trusted workflow files |

## 4) Reused Patterns

| Pattern | Where found | Why it exists |
| --- | --- | --- |
| Firebase singleton/config resolver | `js/firebase.js`, `js/firebase-runtime-config.js` | Share initialized SDK state across many static pages and hosts |
| Service layer | `apps/app/src/lib/*Service.ts` | Keep route components focused and make domain behavior testable |
| Compatibility adapter | `apps/app/src/lib/adapters/legacy*.ts` | Reuse legacy data contracts while the React surface evolves |
| Route-level lazy loading | `apps/app/src/App.tsx` | Reduce initial app bundle and startup cost |
| Error normalization | `apps/app/src/lib/appErrors.ts` | Present stable network/permission/validation failure types |
| Sanitized structured logging | `apps/app/src/lib/logger.ts` | Preserve diagnostic context without tokens or PII |
| Stable aggregate CI job | `mobile-build.yml`, `preview-smoke.yml` | Give branch protection one context despite path-filtered subjobs |
| Build-then-trust handoff | preview and production workflow pairs | Keep PR code credential-free and bind deployment to verified input |
| Exact-head controller handoff | `docs/landing-process.md`, `AGENTS.md` | Prevent concurrent producer/remediator/merger writes |

## 5) Deployment and Trust Flow

```text
PR source
  -> fast tests and path classification
  -> credential-free build/staged artifact
  -> trusted default-branch verifier
  -> current PR head + artifact validation
  -> sanitized handoff
  -> OIDC
  -> fixed PR preview channel

master commit
  -> tests/regression guards
  -> credential-free exact-commit production artifact
  -> protected deploy job validates handoff
  -> OIDC
  -> rules/indexes first when changed
  -> hosting/functions
  -> post-deploy and scheduled smoke
```

Never collapse the preview pair into one privileged PR-code workflow. Do not
move OIDC earlier than validation or execute files from a downloaded artifact
inside the credentialed job.

## 6) Known Architectural Risks

- Legacy and React surfaces share concepts but not one fully extracted domain
  layer. Contract changes can silently update only one consumer.
- `js/db.js`, `functions/index.js`, `scheduleService.ts`, and
  `firestore.rules` are very large, high-churn files with broad blast radius.
- Rules, runtime config, staging scripts, and deploy workflows form one security
  system; changing any one without its consumers can cause either outages or
  privilege regressions.
- Landing ownership is external controller state. It intentionally does not
  alter CI triggers, so correctness depends on PaulBot honoring the claim and
  binding every decision to the frozen exact SHA.

## 7) Evidence

- `apps/app/src/main.tsx`
- `apps/app/src/App.tsx`
- `apps/app/src/lib/adapters/`
- `js/firebase.js`
- `js/firebase-runtime-config.js`
- `functions/index.js`
- `services/chatgpt-mcp/src/server.js`
- `firestore.rules`
- `scripts/stage-pages-bundle.mjs`
- `.github/workflows/deploy-preview.yml`
- `.github/workflows/deploy-preview-trusted.yml`
- `.github/workflows/deploy-prod.yml`
