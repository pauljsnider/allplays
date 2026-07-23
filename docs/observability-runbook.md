# Privacy-preserving observability runbook

## Purpose and current surfaces

ALL PLAYS uses existing first-party infrastructure for operational visibility:

- Legacy web and the React/Capacitor app send best-effort events to `collectTelemetry`.
- `collectTelemetry` writes privacy-reduced raw events, short-lived sessions, and daily aggregates to Firestore. Firestore Rules deny client writes and allow reads only to global admins.
- Firebase Functions write structured failures to Cloud Logging.
- `critical-workflow-health` checks the production deploy, post-deploy smoke, and scheduled recovery workflows every six hours. It creates, updates, and closes one marker-protected GitHub issue when those signals are unhealthy.
- Sentry remains optional and disabled when no DSN is configured. This rollout does not require or enable Sentry, a paid plan, or any new vendor.

Telemetry is never part of a product success path. Collection, sampling, storage, Sentry initialization, and alert reconciliation must fail without blocking authentication, navigation, writes, payments, or native startup.

## Data-minimization contract

The browser collector has no authenticated identity. It never sends an ID token, UID, persistent visitor identifier, page title, query values or keys, exact screen dimensions, timezone, full user agent, form value, element text, error message, click coordinates, or user-authored content.

- `sessionId` is random and stored only in session storage. The compatibility `visitorId` equals that rotating session ID.
- The server hashes event and session identifiers with a daily namespace before storage. It sets `userId` and `visitorId` to `null`.
- Dynamic path segments become `:id`. Cross-origin referrers become only `external`.
- Unknown string properties become `[redacted-text]`; identifier properties become `[id]`. Only code-defined categorical keys retain bounded text.
- Viewport and device data are coarse buckets.
- Error and security events are retained at 100% after a one-minute duplicate window. Automatic page/performance signals are sampled at 25%; automatic interaction signals at 10%. Stored `sampleWeight` keeps aggregate counts interpretable. Explicit code-defined workflow events remain unsampled.
- The server verifies App Check tokens but keeps enforcement in observe/passive mode. Verified requests may contribute at most 15 events and 30 requests per attestation-token fingerprint per minute. Missing or invalid attestation is preserved as a coarse status for rollout measurement and shares a global budget of two events and six accepted requests per minute. Neither raw IP addresses nor reversible IP-derived identifiers are persisted. Excess telemetry is acknowledged and dropped so product flows never retry or fail on collection controls.
- Event names, page paths, and app routes are mapped to a finite source-controlled aggregate vocabulary. Unknown values use `other_event` or `/other` rather than creating attacker-selected aggregate documents.
- Optional Sentry capture uses a 20% default sample, no PII, no breadcrumbs, no user/request/extra payload, a one-minute duplicate window, and redacted exception details. Set no DSN to keep it off.

Do not add a telemetry field that contains names, addresses, roster data, chat, notes, descriptions, payment details, credentials, tokens, arbitrary error messages, Firebase document IDs, or raw URLs. Add a categorical outcome/code instead and extend the privacy tests.

## Retention

Firestore TTL is declared in `firestore.indexes.json`:

| Collection | Retention |
| --- | ---: |
| `telemetrySessions` | 1 day |
| `telemetryRateLimits` | 1 minute plus asynchronous TTL cleanup |
| `telemetryEvents` | 30 days |
| `telemetryDaily`, `telemetryPagesDaily`, `telemetryRoutesDaily`, `telemetryEventsDaily` | 180 days |

TTL deletion is asynchronous after `expiresAt`. Existing documents created before this rollout have no `expiresAt`; they must not be treated as covered. After the production canary, inspect the telemetry collections, export anything genuinely needed, then delete the legacy test telemetry or backfill an approved expiration. Do not disable the TTL policies during an application rollback.

The TTL rollout is declarative and idempotent. Run the repository's installed Firebase CLI through the protected production path with `firebase deploy --only firestore:indexes --project game-flow-c6311`; rerunning the same commit reapplies the seven telemetry `expiresAt` field overrides and does not delete legacy documents. Confirm the seven telemetry policies in the deployment output and Firebase console before continuing. Do not combine this step with a data-cleanup command.

Legacy-data removal is a separate, explicitly approved change window after the 24-hour canary. Before deleting anything, create and verify a recoverable Firestore export in the approved backup location, record its object/prefix and source time, and scope the cleanup only to the telemetry collections and pre-rollout documents being retired. Keep the verified export through post-cleanup validation. Never run legacy cleanup from the index, Functions, Hosting, or monitor deployment.

## Rollout and canary

1. Deploy Firestore indexes first using the idempotent command above and confirm all seven telemetry TTL field policies are enabled. Stop here if any policy is missing or still changing state.
2. Deploy Functions before or together with Hosting/app assets. The v2 client remains accepted by the old endpoint, and the v2 endpoint accepts cached v1 clients while ignoring their auth and persistent visitor identity.
3. Confirm `collectTelemetry` is healthy in Cloud Logging and no deployment error contains a request body, token, or user content.
4. From `https://allplays.ai`, generate one page view and one deliberate handled test error with a non-sensitive categorical label. In the admin telemetry view, confirm:
   - `privacyVersion` is `2`;
   - `userId` and `visitorId` are `null`;
   - the session and event document IDs are 40-character hashes;
   - dynamic routes contain `:id`;
   - `expiresAt` is present;
   - `appCheckStatus` is one of `verified`, `missing`, or `invalid`, and the verified share is measured before any future enforcement decision;
   - no page title, query metadata, user agent, exact screen data, message, or content is stored.
5. Manually run `critical-workflow-health`. A healthy run must make no issue mutation. Use the script unit fixtures to test failure reconciliation; do not deliberately break production deployment or recovery controls.
6. Observe collector failures, write volume, aggregate continuity, and product smoke tests for 24 hours before removing any superseded observability code.

## Rollback

Telemetry must never justify rolling back unrelated product code. If the collector causes load, disable the client with `ALLPLAYS_TELEMETRY_ENABLED=false` in runtime configuration and leave product flows active. If a Functions rollback is necessary, keep the v2 client and TTL policies; cached v1 clients are the only surface that could resume richer collection under the old function. Disable collection before restoring an old collector.

If the critical workflow monitor is noisy, disable only its schedule while investigating and leave deploy, post-deploy smoke, and Firestore recovery workflows enabled. Close its managed issue only after a successful exact check.

## Firestore Rules API retry exhaustion

The production workflow makes eight bounded attempts when a transient Firestore configuration deployment fails. If those attempts are exhausted, the job summary identifies the Google API surface, final HTTP error class, attempt count, and surfaces that were not deployed. The summary uses only fixed operational labels and does not copy API response bodies, credentials, tenant identifiers, or application data.

Application deployment remains fail-closed. When Rules or indexes differ from the last successful production deployment, Hosting and Functions do not deploy until the combined Firestore configuration command succeeds. The Firebase CLI may apply indexes before a later Rules API failure, so treat the Rules and index state as potentially partial and verify both before retrying. Existing Hosting and Functions production remains active; do not bypass the workflow or deploy application surfaces separately.

Safe manual retry:

1. Confirm the failed run targeted `master` and that its summary reports a transient Google API failure rather than a configuration or authorization error. Check the Firebase deploy log or console to determine whether Rules or indexes were already applied.
2. Confirm `master` still contains the intended Firestore configuration. If a newer production deployment succeeded, no retry is needed.
3. In GitHub Actions, open `deploy-prod`, choose **Run workflow**, select `master`, and run it. Manual dispatch is restricted to the current `master` branch and repeats the protected tests, change detection, keyless authentication, bounded retries, and fail-closed ordering.
4. Confirm the Firestore configuration step succeeds before Hosting and Functions, then confirm the production smoke workflow succeeds.

Do not run a local `firebase deploy`, increase retry limits, expose raw API output in the summary, or bypass the protected production environment. If another bounded run ends with the same external error class, treat it as an ongoing Google service incident and leave production on the last successful configuration.

## Critical workflow alert

The managed incident title is `[Observability] Critical production signals are unhealthy`. The reconciler mutates an exact issue only when it was created by `github-actions[bot]`, carries the `security` label, and contains the private management marker. Duplicate or user-created collisions fail closed.

Investigation order:

1. Open the monitor run linked from the incident.
2. Identify the failing signal: current-master production deploy, current-master production smoke, or scheduled Firestore recovery.
3. For deploy/smoke failures, follow the failing run and do not bypass protected environments or tests.
4. For recovery failures or a stale recovery check, follow `docs/firestore-recovery-runbook.md` and preserve PITR, backups, and delete protection.
5. Rerun the failed underlying workflow, then manually rerun `critical-workflow-health`. The bot closes the managed issue only on success.

## Optional Cloud Logging alert (disabled until explicitly configured)

The collector emits a content-free structured failure with `eventType=operational_telemetry_collection_failure`. If Cloud Monitoring notification channels are already approved, create a log-based alert from this exact filter:

```text
resource.type="cloud_function"
jsonPayload.eventType="operational_telemetry_collection_failure"
```

Canary the policy with a non-production function or log fixture. Route it only to an approved operational channel, use a five-minute aggregation window to avoid alert storms, and delete/disable the policy to roll back. No alert policy or notification channel is created by this PR.
