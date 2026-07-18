import { describe, expect, it } from 'vitest';

import {
    evaluateFirestoreRecoveryPosture,
    parseFirestoreRecoveryArgs
} from '../../scripts/verify-firestore-recovery.mjs';

const now = Date.parse('2026-07-18T12:00:00Z');

function healthyInput() {
    return {
        now,
        database: {
            uid: 'current-database-uid',
            pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_ENABLED',
            deleteProtectionState: 'DELETE_PROTECTION_ENABLED'
        },
        schedules: [{
            name: 'daily',
            dailyRecurrence: {},
            retention: '1209600s',
            createTime: '2026-07-17T12:00:00Z'
        }],
        backups: [{
            name: 'backup-1',
            databaseUid: 'current-database-uid',
            state: 'READY',
            snapshotTime: '2026-07-18T06:00:00Z'
        }]
    };
}

describe('Firestore recovery posture', () => {
    it('requires an explicit project instead of silently targeting production', () => {
        expect(() => parseFirestoreRecoveryArgs([], {})).toThrow(/FIREBASE_PROJECT_ID.*--project/);
        expect(parseFirestoreRecoveryArgs(['--project', 'demo-project'], {})).toMatchObject({
            projectId: 'demo-project',
            databaseId: '(default)',
            maxBackupAgeHours: 36
        });
        expect(parseFirestoreRecoveryArgs(['--project=demo-project'], {})).toMatchObject({
            projectId: 'demo-project',
            databaseId: '(default)',
            maxBackupAgeHours: 36
        });
    });

    it('accepts PITR, delete protection, 14-day daily backups, and a fresh ready backup', () => {
        expect(evaluateFirestoreRecoveryPosture(healthyInput())).toMatchObject({
            healthy: true,
            failures: [],
            newestBackup: { name: 'backup-1' }
        });
    });

    it('fails closed when recovery controls are absent or too weak', () => {
        const result = evaluateFirestoreRecoveryPosture({
            now,
            database: {},
            schedules: [{ dailyRecurrence: {}, retention: '604800s', createTime: '2026-07-01T00:00:00Z' }],
            backups: []
        });

        expect(result.healthy).toBe(false);
        expect(result.failures).toEqual(expect.arrayContaining([
            'Point-in-time recovery is not enabled.',
            'Database delete protection is not enabled.',
            'The current database UID is unavailable, so backup lineage cannot be verified.',
            'The daily managed-backup retention is shorter than 14 days.',
            'The daily schedule has not produced a ready backup within its initial 36-hour window.'
        ]));
    });

    it('fails when the newest completed backup is stale', () => {
        const input = healthyInput();
        input.backups[0].snapshotTime = '2026-07-15T00:00:00Z';

        expect(evaluateFirestoreRecoveryPosture(input)).toMatchObject({
            healthy: false,
            failures: ['The newest ready backup is older than 36 hours.']
        });
    });

    it('allows only the documented first-backup grace window', () => {
        const input = healthyInput();
        input.schedules[0].createTime = '2026-07-18T02:42:05Z';
        input.backups = [];

        expect(evaluateFirestoreRecoveryPosture(input)).toMatchObject({
            healthy: true,
            notices: [expect.stringContaining('initial 36-hour window')]
        });
    });

    it('rejects a fresh backup from an older database incarnation', () => {
        const input = healthyInput();
        input.schedules[0].createTime = '2026-07-16T00:00:00Z';
        input.backups[0].databaseUid = 'retired-database-uid';

        expect(evaluateFirestoreRecoveryPosture(input)).toMatchObject({
            healthy: false,
            failures: ['The daily schedule has not produced a ready backup within its initial 36-hour window.'],
            newestBackup: null
        });
    });

    it('treats old-incarnation backups as absent during the initial schedule grace window', () => {
        const input = healthyInput();
        input.schedules[0].createTime = '2026-07-18T02:42:05Z';
        input.backups[0].databaseUid = 'retired-database-uid';

        expect(evaluateFirestoreRecoveryPosture(input)).toMatchObject({
            healthy: true,
            failures: [],
            notices: [expect.stringContaining('initial 36-hour window')],
            newestBackup: null
        });
    });

    it('fails closed when the current database UID cannot be established', () => {
        const input = healthyInput();
        delete input.database.uid;
        input.schedules[0].createTime = '2026-07-18T02:42:05Z';
        input.backups = [];

        expect(evaluateFirestoreRecoveryPosture(input)).toMatchObject({
            healthy: false,
            failures: ['The current database UID is unavailable, so backup lineage cannot be verified.'],
            notices: [expect.stringContaining('initial 36-hour window')],
            newestBackup: null
        });
    });
});
