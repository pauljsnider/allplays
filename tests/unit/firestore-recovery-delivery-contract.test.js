import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const workflow = readSource('.github/workflows/firestore-recovery-health.yml');
const runbook = readSource('docs/firestore-recovery-runbook.md');
const packageSource = readSource('package.json');

describe('Firestore recovery delivery contract', () => {
    it('keeps the scheduled production check authenticated before gcloud runs', () => {
        const authIndex = workflow.indexOf('uses: google-github-actions/auth@v3');
        const setupIndex = workflow.indexOf('uses: google-github-actions/setup-gcloud@v3');
        const verifyIndex = workflow.indexOf('run: npm run ops:verify-firestore-recovery');

        expect(workflow).toContain("cron: '17 15 * * *'");
        expect(workflow).toContain('environment: production');
        expect(authIndex).toBeGreaterThan(-1);
        expect(workflow).toContain('secrets.FIREBASE_SERVICE_ACCOUNT_GAME_FLOW_C6311');
        expect(workflow).not.toContain('secrets.FIRESTORE_RECOVERY_READ_ONLY_SERVICE_ACCOUNT_GAME_FLOW_C6311');
        expect(workflow).toContain('create_credentials_file: true');
        expect(workflow).toContain('cleanup_credentials: true');
        expect(setupIndex).toBeGreaterThan(authIndex);
        expect(verifyIndex).toBeGreaterThan(setupIndex);
        expect(workflow).toContain('FIREBASE_PROJECT_ID: game-flow-c6311');
    });

    it('keeps the verifier command available and the documented invocation executable', () => {
        expect(packageSource).toContain('"ops:verify-firestore-recovery": "node scripts/verify-firestore-recovery.mjs"');
        expect(runbook).toContain('npm run ops:verify-firestore-recovery -- --project="$ALLPLAYS_FIRESTORE_PROJECT_ID"');
    });

    it('documents the complete least-privilege IAM contract for verification', () => {
        expect(runbook).toContain('datastore.databases.getMetadata');
        expect(runbook).toContain('datastore.backupSchedules.list');
        expect(runbook).toContain('datastore.backups.list');
        expect(runbook).toContain('roles/datastore.viewer');
        expect(runbook).toContain('roles/datastore.backupSchedulesViewer');
        expect(runbook).toContain('roles/datastore.backupsViewer');
        expect(runbook).toContain('`roles/datastore.viewer` can also read application');
    });

    it('keeps restore drills isolated from the production database', () => {
        expect(runbook).toContain('Never restore over `(default)`');
        expect(runbook).toContain("--destination-database='restore-drill-YYYYMMDD'");
        expect(runbook).toContain("--destination-database='backup-drill-YYYYMMDD'");
        expect(runbook).toMatch(/A managed backup restore always creates a new\s+database/);
        expect(runbook).toContain('2026-07-18 PITR clone drill');
    });
});
