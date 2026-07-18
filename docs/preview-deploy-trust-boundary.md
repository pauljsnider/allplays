# Firebase preview deployment trust boundary

## Required invariants

The `deploy-preview` pull-request workflow executes untrusted PR code. It must
never receive a Firebase credential or a repository token with write
permissions. It may only test, build, stage public Hosting content, and upload
the single `firebase-preview-hosting-bundle` artifact.

The `deploy-preview-trusted` workflow is the only preview deployer. GitHub runs
its `workflow_run` definition from the default branch. It checks out only the
default branch, validates the completed run and current open PR through the
GitHub API, downloads only the verified triggering-run artifact, safely
validates and extracts public files, and generates Firebase configuration from
trusted default-branch code. It never checks out, imports, executes, or sources
PR code or PR-provided Firebase configuration.

`FIREBASE_SERVICE_ACCOUNT_GAME_FLOW_C6311` must remain absent from repository
and organization secrets. It may exist only as an environment secret in
`firebase-preview-trusted` and `production`. Both environments must retain a
protected/default-branch-only deployment policy. This is essential: a
same-repository PR can edit its own `pull_request` workflow and reference any
repository-level secret, even when the default-branch version does not.

`SMOKE_AUTH_EMAIL` and `SMOKE_AUTH_PASSWORD` must also remain absent from
repository and organization secrets. They may exist only in the protected
`production-smoke` environment used by `post-deploy-smoke` and
`scheduled-prod-smoke`. Those workflows execute only default/protected-branch
code, have read-only repository permissions, and must keep checkout credentials
disabled. Rotate the smoke password immediately if either value is ever exposed
outside that environment.

The trusted workflow may deploy only the verified PR's fixed `pr-N` Firebase
Hosting channel. It must not prune, delete, or select another channel. All
third-party actions in both workflows must remain pinned to full commit SHAs.
Trusted runs must be serialized and cancelable per PR, not per workflow run.
The PR must still be open at the triggering head when credentials become
available, immediately before the Firebase channel write, and immediately
before the shared preview comment write. A failed recheck must stop the related
external write.

## Review and operational checks

Before merging a change to either preview workflow:

1. Run `npm run test:unit:ci`, `npm run test:functions:auth-email`,
   `npm run app:build`, and the focused preview trust-boundary tests.
2. Confirm `gh secret list --repo pauljsnider/allplays` lists none of
   `FIREBASE_SERVICE_ACCOUNT_GAME_FLOW_C6311`, `SMOKE_AUTH_EMAIL`, or
   `SMOKE_AUTH_PASSWORD`.
3. Confirm `gh secret list --repo pauljsnider/allplays --env production` and
   `--env firebase-preview-trusted` each list the credential.
4. Confirm all three GitHub environments still restrict deployments to
   protected/default-branch code before allowing a credentialed run. Confirm
   `production-smoke` contains only the rotated least-privilege smoke fixture
   credentials.
5. Review the exact PR head SHA after all requested automated reviews and CI
   complete. Any new commit invalidates prior review evidence.

The first `workflow_run` preview cannot execute until this workflow and its
trusted verifier scripts are present on the default branch. The PR workflow's
artifact build remains testable before merge; the first post-merge PR run is
the deployment canary.

## JSON-key rotation and retirement

Use the following sequence without printing JSON key material:

1. Record the old and replacement GCP service-account key IDs in the private
   incident record. Store the replacement JSON only in the two protected GitHub
   environments; never store it as a repository or organization secret.
2. Validate an exact-default-branch production deploy and a same-repository PR
   preview deploy with the replacement key. Confirm the preview deploy targets
   only `pr-N`, the expected URL is commented on that PR, and the credential
   cleanup step runs.
3. Query Cloud Audit Logs for the old key ID across its full GitHub exposure
   window, including `authenticationInfo.serviceAccountKeyName`, and inspect
   same-repository Actions runs for unexpected credentialed workflow changes or
   Firebase operations. Preserve suspicious run IDs and audit entries.
4. Disable the old GCP service-account key after both canaries pass. Re-run the
   production and preview canaries, then permanently delete the old key after
   the agreed observation window. If either canary fails, re-enable only long
   enough to diagnose; do not restore a repository-level secret.
5. Reconfirm the repository secret is absent and both environment policies are
   intact after retirement.

The long-term target is keyless GitHub OIDC/Workload Identity Federation with a
dedicated preview principal. Bind trust to this repository, the trusted
workflow identity, and the default branch; grant only the Firebase Hosting
operations required to release a preview channel. Validate OIDC canaries, then
delete the remaining JSON key and remove the JSON environment secrets.
