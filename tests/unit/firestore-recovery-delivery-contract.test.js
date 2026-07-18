import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const workflow = readSource('.github/workflows/firestore-recovery-health.yml');
const runbook = readSource('docs/firestore-recovery-runbook.md');
const strategy = readSource('spec/firestore-backup-strategy.md');
const packageSource = readSource('package.json');
const verifier = readSource('scripts/verify-firestore-recovery.mjs');
const issueReconciler = readSource('scripts/reconcile-firestore-recovery-issue.mjs');

describe('Firestore recovery delivery contract', () => {
    it('uses fail-closed keyless OIDC before gcloud without any JSON credential secret', () => {
        const preflightIndex = workflow.indexOf('node scripts/verify-firestore-recovery-identity.mjs');
        const authIndex = workflow.indexOf('uses: google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093');
        const setupIndex = workflow.indexOf('uses: google-github-actions/setup-gcloud@aa5489c8933f4cc7a4f7d45035b3b1440c9c10db');
        const verifyIndex = workflow.indexOf('run: npm run ops:verify-firestore-recovery');

        expect(workflow).toContain('id-token: write');
        expect(workflow).toContain('workload_identity_provider: ${{ vars.FIRESTORE_RECOVERY_WORKLOAD_IDENTITY_PROVIDER }}');
        expect(workflow).toContain('service_account: ${{ vars.FIRESTORE_RECOVERY_SERVICE_ACCOUNT }}');
        expect(workflow).toContain('create_credentials_file: true');
        expect(workflow).toContain('cleanup_credentials: true');
        expect(workflow).not.toContain('credentials_json');
        expect(workflow).not.toContain('SERVICE_ACCOUNT_GAME_FLOW_C6311 }}');
        expect(workflow).not.toContain('npm ci');
        expect(preflightIndex).toBeGreaterThan(-1);
        expect(authIndex).toBeGreaterThan(preflightIndex);
        expect(setupIndex).toBeGreaterThan(authIndex);
        expect(verifyIndex).toBeGreaterThan(setupIndex);
    });

    it('bounds the health job and escalates ordinary failure or timeout in a separate job', () => {
        expect(workflow).toMatch(/verify-recovery:[\s\S]*?timeout-minutes: 10/);
        expect(workflow).toContain('reconcile-recovery-status:');
        expect(workflow).toContain('if: ${{ always() }}');
        expect(workflow).toMatch(/reconcile-recovery-status:[\s\S]*?timeout-minutes: 5/);
        expect(workflow).toMatch(/reconcile-recovery-status:[\s\S]*?issues: write/);
        expect(workflow).toContain('run: node scripts/reconcile-firestore-recovery-issue.mjs');
        expect(issueReconciler).toContain('Firestore recovery posture is unverified');
        expect(issueReconciler).toContain('<!-- allplays-firestore-recovery-health -->');
        expect(issueReconciler).toContain("RECOVERY_ISSUE_AUTHOR_ID = 41898282");
        expect(issueReconciler).toContain("RECOVERY_ISSUE_AUTHOR = 'github-actions[bot]'");
        expect(issueReconciler).toContain("RECOVERY_ISSUE_LABEL = 'recovery-monitor'");
        expect(issueReconciler).toContain("issue.user?.type !== 'Bot'");
        expect(issueReconciler).toContain('refusing ambiguous mutation');
        expect(issueReconciler).toContain('docs/firestore-recovery-runbook.md#health-check-failure');
        expect(issueReconciler).toContain('process.exitCode = 1');
        expect(issueReconciler).toContain('author:app/github-actions');
        expect(runbook).toContain('public-user title/marker copies are ignored');
        expect(runbook).toContain('That issue handles explicit workflow failures but is not a dead-man.');
        expect(runbook).toMatch(/route\s+failures from the `firestore-recovery-health` workflow/);
        expect(runbook).toContain("latest `event=schedule` run");
        expect(runbook).toContain('outside this repository\'s GitHub Actions');
    });

    it('keeps the verifier commands available and the documented invocation executable', () => {
        expect(packageSource).toContain('"ops:verify-firestore-recovery": "node scripts/verify-firestore-recovery.mjs"');
        expect(packageSource).toContain('"ops:verify-firestore-recovery-identity": "node scripts/verify-firestore-recovery-identity.mjs"');
        expect(runbook).toContain('npm run ops:verify-firestore-recovery -- --project="$ALLPLAYS_FIRESTORE_PROJECT_ID"');
    });

    it('documents the exact least-privilege Google and GitHub identity contract', () => {
        expect(runbook).toContain('datastore.databases.getMetadata');
        expect(runbook).toContain('datastore.backupSchedules.list');
        expect(runbook).toContain('datastore.backups.list');
        expect(runbook).toContain('roles/iam.workloadIdentityUser');
        expect(runbook).toContain('does not need Service Account Token Creator');
        expect(runbook).toContain('projects/982493478258/locations/global/workloadIdentityPools/github-actions/providers/allplays-recovery');
        expect(runbook).toContain('allplays-firestore-recovery@game-flow-c6311.iam.gserviceaccount.com');
        expect(runbook).toContain('attribute.repository_id=assertion.repository_id');
        expect(runbook).toContain('attribute.repository_owner_id=assertion.repository_owner_id');
        expect(runbook).toContain('attribute.workflow_ref=assertion.workflow_ref');
        expect(runbook).toContain("assertion.repository_id == '1106220007' && assertion.repository_owner_id == '211066188'");
        expect(runbook).toContain('attribute.repository_id/1106220007');
        expect(runbook).not.toContain('attribute.repository=assertion.repository');
        expect(runbook).toContain('pauljsnider/allplays/.github/workflows/firestore-recovery-health.yml@refs/heads/master');
        expect(runbook).toContain('no user-managed key');
        expect(runbook).toContain('zero user-managed keys');
        expect(runbook).toContain('pool/provider `ACTIVE`');
        expect(runbook).toContain('first workflow dispatch\nand scheduled heartbeat still must succeed');
    });

    it('keeps restore drills isolated and deletion guarded to one exact target', () => {
        expect(runbook).toContain('Never restore over `(default)`');
        expect(runbook).toContain('--destination-database="$ALLPLAYS_PITR_DRILL_DATABASE"');
        expect(runbook).toContain('--destination-database="$ALLPLAYS_BACKUP_DRILL_DATABASE"');
        expect(runbook).toContain('set -euo pipefail');
        expect(runbook).toContain("test \"$ALLPLAYS_BACKUP_DRILL_DATABASE\" != '(default)'");
        expect(runbook).toContain('^backup-drill-[0-9]{8}-[a-z0-9]{6}$');
        expect(runbook).toContain('test "$actual_resource" = "projects/$ALLPLAYS_FIRESTORE_PROJECT_ID/databases/$EXPECTED_BACKUP_DRILL_DATABASE"');
        expect(runbook).toContain('test "$actual_uid" = "$EXPECTED_BACKUP_DRILL_UID"');
        expect(runbook).toContain('test -n "$actual_etag"');
        expect(runbook).toContain('test "$actual_source_backup" = "$EXPECTED_BACKUP_RESOURCE"');
        expect(runbook).toContain("readonly EXPECTED_BACKUP_RESTORE_OPERATION='EXACT_RESTORE_OPERATION_RECORDED_AND_MONITORED_ABOVE'");
        expect(runbook).toContain('.metadata.operationState == "SUCCESSFUL"');
        expect(runbook).toContain('.metadata.backup == $backup');
        expect(runbook).toContain('.response.uid == $uid');
        expect(runbook).not.toContain("'.sourceInfo.progress'");
        expect(runbook).toContain('"https://firestore.googleapis.com/v1/$actual_resource?updateMask=deleteProtectionState"');
        expect(runbook).toContain('{name: $name, deleteProtectionState: "DELETE_PROTECTION_DISABLED", etag: $etag}');
        expect(runbook).toContain('test "$(jq -r \'.name\' <<< "$protection_update_operation_json")" = "$protection_update_operation"');
        expect(runbook).toContain('test "$protection_update_complete" = true');
        expect(runbook).not.toContain('--no-delete-protection');
        expect(runbook).toContain("test \"$(jq -r '.deleteProtectionState' <<< \"$target_after_json\")\" = 'DELETE_PROTECTION_DISABLED'");
        expect(runbook).toContain('--etag="$post_update_etag"');
        expect(runbook).toContain('EXPECTED_SOURCE_DATABASE_UID');
        expect(runbook).toContain('--database="$EXPECTED_BACKUP_DRILL_DATABASE"');
        expect(runbook).toContain('return `NOT_FOUND`');
        expect(runbook).toContain('Never disable delete protection on `(default)`');
        expect(runbook).not.toContain('--database=*');
    });

    it('gives PITR drills the same unique-target and ETag cleanup boundary', () => {
        expect(runbook).toContain("^restore-drill-[0-9]{8}-[a-z0-9]{6}$");
        expect(runbook).toContain('Require an exact describe of this destination to return NOT_FOUND first.');
        expect(runbook).toContain('Freeze the returned destination\nname and UID');
        expect(runbook).toContain('final\nETag cleanup pattern');
        expect(runbook).toContain('Never reuse a prior drill ID or directly delete by\nname alone');
    });

    it('requires and records deterministic managed-backup content evidence beyond counts', () => {
        expect(runbook).toContain('Status: **tested successfully on 2026-07-18**');
        expect(runbook).toContain('require its `updateTime` to be at or before the selected backup');
        expect(runbook).toContain("jq -ceS '.fields // {}'");
        expect(runbook).toContain("record `documentPath<TAB>sha256`");
        expect(runbook).toMatch(/require\s+both `cmp` of the manifests and the SHA-256 of the complete manifests to match/);
        expect(runbook).toContain('replace every access-code document\nID with `[redacted]`');
        expect(runbook).toContain('`accessCodes/[redacted]`');
        expect(runbook).not.toMatch(/accessCodes\/[A-Za-z0-9]{20}/);
        expect(runbook).toContain('Do not print field values');
        expect(runbook).toContain('Counts\ncaptured from the live source after the backup are contextual inventory');
        expect(runbook).toContain('48945c35c303427aa31e0619436a4a2b9b82b4077aed9ffc54bd94eb973beb68');
        expect(runbook).toContain("recaptured that target's rotating ETag");
        expect(strategy).toContain('ETag-guarded cleanup');
        expect(strategy).toContain('managed-backup restore also completed successfully');
    });

    it('preserves the successful PITR evidence without upgrading its claim', () => {
        expect(runbook).toContain('2026-07-18 PITR clone drill');
        expect(runbook).toContain('2026-07-18T02:40:00Z');
        expect(runbook).toContain('restore-drill-20260718a');
        expect(runbook).toContain('all sampled source and clone counts matched');
        expect(runbook).toContain('It does not claim field-checksum validation for the PITR clone');
        expect(strategy).toContain('PITR clone drill completed successfully');
    });

    it('keeps command execution bounded and failure output actionable', () => {
        expect(verifier).toContain('timeout: 2 * 60 * 1000');
        expect(verifier).toContain("error?.code === 'ETIMEDOUT'");
        expect(verifier).toContain('OIDC authentication');
        expect(verifier).toContain('the three recovery metadata permissions');
    });

    it('uses a six-hour cadence, immutable action revisions, and an exact Cloud SDK', () => {
        expect(workflow).toContain("cron: '17 */6 * * *'");
        expect(workflow).toContain('actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd');
        expect(workflow).toContain('actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444');
        expect(workflow).toContain('google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093');
        expect(workflow).toContain('google-github-actions/setup-gcloud@aa5489c8933f4cc7a4f7d45035b3b1440c9c10db');
        expect(workflow).toContain("version: '557.0.0'");
        expect(workflow).not.toMatch(/uses: [^\n]+@v\d+\s*$/m);
    });

    it('pins the production schedule and never treats backup createTime as snapshot evidence', () => {
        expect(verifier).toContain('8a7f67fe-c6eb-4a4e-8a48-20e96e9fdf57');
        expect(verifier).toContain('2026-07-18T02:42:05.213778Z');
        expect(verifier).toContain('return timestampMillis(backup?.snapshotTime);');
        expect(verifier).not.toContain('snapshotTime ?? backup?.createTime');
        expect(verifier).toContain('MINIMUM_BACKUP_REMAINING_HOURS = 6');
        expect(runbook).toContain('a valid `expireTime` beyond\nthe next six-hour health-check window');
        expect(runbook).toContain('Recreating or replacing that schedule fails verification');
        expect(runbook).toContain("a backup's\n`createTime` is never accepted as a freshness substitute");
    });
});
