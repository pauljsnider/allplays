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
trusted default-branch code in a job with no OIDC permission. That job installs
the isolated Firebase CLI and uploads a sanitized same-run handoff. Only a
minimal dependent deploy job can request OIDC; the raw PR artifact, checkout,
dependency installation, and configuration generation never enter that job.
The deploy job never checks out, imports, executes, or sources PR code or
PR-provided Firebase configuration.

Firebase deploy workflows authenticate with GitHub OIDC and Google Workload
Identity Federation. They must never reference a JSON service-account key.
Production dependency installation, app/function preparation, rule-change
detection, and bundle construction also run in a no-OIDC job. The production
identity exists only in a minimal dependent deploy job that consumes the fixed
same-run handoff; it performs no checkout, package installation, or build.
`FIREBASE_DEPLOY_WORKLOAD_IDENTITY_PROVIDER` and
`FIREBASE_DEPLOY_SERVICE_ACCOUNT` are environment variables in
`firebase-preview-trusted` and `production`; both environments must retain a
protected/default-branch-only deployment policy. The Google provider must bind
the immutable repository and owner IDs, `refs/heads/master`, and the exact
`workflow_ref` values for the recovery, production, and trusted-preview
workflows. Each service account's `roles/iam.workloadIdentityUser` binding must
be narrower still: only its exact workflow_ref may impersonate it.

The preview deploy uses a dedicated service account with Firebase Hosting
Admin, Service Usage API Keys Viewer, and the project custom role
`allplaysPreviewAuthDomainUpdater`. That custom role contains only
`firebaseauth.configs.get` and `firebaseauth.configs.update`, which the pinned
Firebase CLI needs to add and prune preview channel domains in Firebase Auth.
Do not replace it with Identity Platform Admin or another broad Auth role. The
workflow treats the CLI's otherwise non-fatal Auth-domain warnings as a failed,
partially functional preview. The preview identity must never share the production
deployer. Generated `gha-creds-*.json` ADC files are ignored by Git, removed
explicitly before the PR comment write, and also registered for authentication
action cleanup. `FIREBASE_SERVICE_ACCOUNT_GAME_FLOW_C6311` must remain absent
from repository and organization secrets. A transitional copy may remain in
the two protected environments only until both OIDC canaries pass; no workflow
may reference it during that observation window.

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
3. Confirm the `production` and `firebase-preview-trusted` environments each
   define `FIREBASE_DEPLOY_WORKLOAD_IDENTITY_PROVIDER` and
   `FIREBASE_DEPLOY_SERVICE_ACCOUNT`, and that the service-account values are
   different. Confirm neither workflow references a JSON credential secret.
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

## Workload Identity cutover and JSON-key retirement

Use the following sequence without printing JSON key material:

1. Before changing IAM, export the provider, both service-account IAM policies,
   project role bindings, environment variables, environment secrets, and the
   remaining key ID to a private rollback record. Do not print key JSON.
2. Keep one provider for the GitHub issuer. Its CEL condition must require
   repository ID `1106220007`, owner ID `211066188`, master, and one of the
   three exact workflow_ref values. Replace the recovery service account's
   repository-wide impersonation binding with its exact workflow_ref binding
   before broadening the provider condition.
3. Bind the production deploy workflow only to the production service account.
   Bind the trusted-preview workflow only to its dedicated preview service
   account, with `roles/firebasehosting.admin`,
   `roles/serviceusage.apiKeysViewer`, and the project custom role
   `allplaysPreviewAuthDomainUpdater` containing only
   `firebaseauth.configs.get` and `firebaseauth.configs.update`. Do not grant
   preview project Editor, Identity Platform Admin,
   Functions, Firestore, Storage, or production-service-account impersonation.
4. Validate the next exact-default-branch production deploy. A rules-changing
   release must still deploy Firestore rules/indexes before application code;
   a rules-unchanged release must skip the redundant Rules API call. Then run a
   same-repository PR preview and confirm it targets only `pr-N`, comments the
   expected URL, and removes its ephemeral ADC file before commenting.
5. Query Cloud Audit Logs for the old key ID across its full GitHub exposure
   window, including `authenticationInfo.serviceAccountKeyName`, and inspect
   same-repository Actions runs for unexpected credentialed workflow changes or
   Firebase operations. Preserve suspicious run IDs and audit entries.
6. After both OIDC canaries pass, delete the unused JSON secrets from both
   environments, rerun both canaries, and permanently delete the remaining GCP
   service-account key. Reconfirm the repository secret is absent and both
   environment policies are intact.

If OIDC authentication fails, leave the current production release untouched,
restore the recorded IAM/environment state, and revert the workflow commit.
Only the protected environment JSON secret may be used for a time-bounded
rollback; never recreate a repository-level secret.

Primary references: Google Cloud's deployment-pipeline Workload Identity
Federation guide, Workload Identity Federation best practices, the pinned
`google-github-actions/auth` documentation, and Firebase's predefined Hosting
role documentation.
