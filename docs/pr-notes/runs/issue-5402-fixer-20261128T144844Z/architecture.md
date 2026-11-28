# Architecture analysis

The requested `allplays-architecture-expert` skill was unavailable, and the required role subagent failed with `published reply runtime missing for main`. This fallback analysis applies the requested senior Firebase architecture role.

## Root cause

The production helper returned success solely from the Firebase CLI process exit status. It never translated the CLI's per-function terminal result lines into evidence or invoked `verifyFirebaseApplicationDeployment`, so a zero-exit partial targeted deployment could advance to migrations, full application deployment, and production-success markers.

## Minimal design

- Preserve the successful targeted attempt log from `retry_firebase_deploy`.
- Use a small adapter to convert exact Firebase CLI `Successful create/update operation` and `Skipped (No changes detected)` lines into terminal evidence.
- Invoke the existing aggregate verifier against the authoritative intended-target list immediately after the targeted deploy.
- Keep the adapter and existing verifier inside the trusted artifact, verify fixed SHA-256 digests before OIDC use, and execute only those verified copies.
- Rely on the deploy step's existing `set -euo pipefail` so any missing, duplicate, or malformed evidence terminates the job before subsequent success paths.
