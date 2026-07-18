import { describe, expect, it } from 'vitest';

import {
    collectFirestoreRecoveryPosture,
    evaluateFirestoreRecoveryPosture,
    EXPECTED_PRODUCTION_DAILY_SCHEDULE,
    EXPECTED_PRODUCTION_DAILY_SCHEDULE_CREATE_TIME,
    MAX_FUTURE_CLOCK_SKEW_MS,
    MAX_MAX_BACKUP_AGE_HOURS,
    parseFirestoreRecoveryArgs
} from '../../scripts/verify-firestore-recovery.mjs';

const now = Date.parse('2026-07-18T12:00:00Z');
const currentDatabaseUid = '523d6949-79b4-4368-b4cd-57c164d3451d';
const retiredDatabaseUid = '6d8dc48d-5e2f-4cee-8f74-5325ad0847fd';
const demoDatabaseName = 'projects/demo-project/databases/(default)';
const demoScheduleName = `${demoDatabaseName}/backupSchedules/8a7f67fe-c6eb-4a4e-8a48-20e96e9fdf57`;
const demoBackupName = 'projects/demo-project/locations/nam5/backups/d51ba64c-aa47-4372-a7fc-b78813ad6669';

function healthyInput() {
    return {
        now,
        database: {
            name: demoDatabaseName,
            uid: currentDatabaseUid,
            pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_ENABLED',
            deleteProtectionState: 'DELETE_PROTECTION_ENABLED'
        },
        schedules: [{
            name: demoScheduleName,
            dailyRecurrence: {},
            retention: '1209600s',
            createTime: '2026-07-17T12:00:00Z'
        }],
        backups: [{
            name: demoBackupName,
            database: demoDatabaseName,
            databaseUid: currentDatabaseUid,
            state: 'READY',
            snapshotTime: '2026-07-18T06:00:00Z',
            expireTime: '2026-08-01T06:00:00Z'
        }]
    };
}

describe('Firestore recovery CLI arguments', () => {
    it('requires an explicit project instead of silently targeting production', () => {
        expect(() => parseFirestoreRecoveryArgs([], {})).toThrow(/FIREBASE_PROJECT_ID.*--project/);
    });

    it('supports environment, separated, and npm-forwarded assignment flags', () => {
        expect(parseFirestoreRecoveryArgs([], { FIREBASE_PROJECT_ID: 'demo-project' })).toEqual({
            projectId: 'demo-project',
            databaseId: '(default)',
            maxBackupAgeHours: 36
        });
        expect(parseFirestoreRecoveryArgs(['--project', 'demo-project'], {})).toMatchObject({
            projectId: 'demo-project'
        });
        expect(parseFirestoreRecoveryArgs(['--project=demo-project'], {})).toMatchObject({
            projectId: 'demo-project'
        });
    });

    it.each(['NaN', 'Infinity', '-Infinity', '0', '-1', '169', '1e309', ''])
    ('rejects an unsafe maximum backup age of %j', (value) => {
        expect(() => parseFirestoreRecoveryArgs([
            '--project=demo-project',
            `--max-backup-age-hours=${value}`
        ], {})).toThrow(/finite number from 1 through 168/);
    });

    it('accepts the finite maximum boundary and decimals inside the boundary', () => {
        expect(parseFirestoreRecoveryArgs([
            '--project=demo-project',
            `--max-backup-age-hours=${MAX_MAX_BACKUP_AGE_HOURS}`
        ], {})).toMatchObject({ maxBackupAgeHours: 168 });
        expect(parseFirestoreRecoveryArgs([
            '--project=demo-project',
            '--max-backup-age-hours=1.5'
        ], {})).toMatchObject({ maxBackupAgeHours: 1.5 });
    });

    it('rejects unknown, duplicate, missing-value, malformed project, and malformed database flags', () => {
        expect(() => parseFirestoreRecoveryArgs(['--project=demo-project', '--typo=yes'], {})).toThrow(/Unknown/);
        expect(() => parseFirestoreRecoveryArgs(['--project=demo-project', '--project=other-project'], {})).toThrow(/only once/);
        expect(() => parseFirestoreRecoveryArgs(['--project', '--database=(default)'], {})).toThrow(/requires a value/);
        expect(() => parseFirestoreRecoveryArgs(['--project=INVALID'], {})).toThrow(/project ID is invalid/);
        expect(() => parseFirestoreRecoveryArgs(['--project=demo-project', '--database=../default'], {})).toThrow(/database ID is invalid/);
    });
});

describe('Firestore recovery posture', () => {
    it('accepts PITR, delete protection, 14-day retention, exact READY state, matching UID, and a fresh backup', () => {
        expect(evaluateFirestoreRecoveryPosture(healthyInput())).toMatchObject({
            healthy: true,
            failures: [],
            notices: [],
            newestBackup: { name: demoBackupName }
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
            'The current database UID is unavailable or invalid, so backup lineage cannot be verified.',
            'The daily managed-backup retention is shorter than 14 days or invalid.',
            'The daily schedule has not produced a ready backup within its initial 36-hour window.'
        ]));
    });

    it.each([undefined, null, '', 'not-a-duration', '1209599.999999999s', 'Infinitys'])
    ('rejects invalid or short retention %j', (retention) => {
        const input = healthyInput();
        input.schedules[0].retention = retention;
        const result = evaluateFirestoreRecoveryPosture(input);
        expect(result.healthy).toBe(false);
        expect(result.failures).toContain('The daily managed-backup retention is shorter than 14 days or invalid.');
    });

    it('accepts fractional duration syntax at or beyond the 14-day floor', () => {
        const input = healthyInput();
        input.schedules[0].retention = '1209600.000000001s';
        expect(evaluateFirestoreRecoveryPosture(input).healthy).toBe(true);
    });

    it('fails if no daily schedule exists or if metadata reports multiple daily schedules', () => {
        const missing = healthyInput();
        missing.schedules = [{ weeklyRecurrence: {}, retention: '1209600s' }];
        expect(evaluateFirestoreRecoveryPosture(missing).failures).toContain('No daily managed-backup schedule exists.');

        const duplicate = healthyInput();
        duplicate.schedules.push({
            dailyRecurrence: {},
            retention: '1209600s',
            createTime: '2026-07-17T12:00:00Z'
        });
        expect(evaluateFirestoreRecoveryPosture(duplicate).failures).toContain(
            'More than one daily managed-backup schedule exists; expected exactly one.'
        );
    });

    it('fails when the newest completed backup is stale', () => {
        const input = healthyInput();
        input.backups[0].snapshotTime = '2026-07-15T00:00:00Z';

        expect(evaluateFirestoreRecoveryPosture(input)).toMatchObject({
            healthy: false,
            failures: ['The newest ready backup is older than 36 hours.']
        });
    });

    it.each([
        ['missing', undefined, false],
        ['unknown', 'UNKNOWN', true],
        ['creating', 'CREATING', true],
        ['lowercase ready', 'ready', true],
        ['null', null, true],
        ['number', 1, true],
        ['boolean', true, true],
        ['object', { value: 'READY' }, true]
    ])('rejects a backup whose state is %s', (_description, state, hasState) => {
        const input = healthyInput();
        input.schedules[0].createTime = '2026-07-16T00:00:00Z';
        if (hasState) input.backups[0].state = state;
        else delete input.backups[0].state;

        expect(evaluateFirestoreRecoveryPosture(input)).toMatchObject({
            healthy: false,
            failures: ['The daily schedule has not produced a ready backup within its initial 36-hour window.'],
            newestBackup: null
        });
    });

    it('does not let a newer non-ready backup hide a fresh exact-ready backup', () => {
        const input = healthyInput();
        input.backups.push({
            name: 'backup-creating',
            databaseUid: currentDatabaseUid,
            state: 'CREATING',
            snapshotTime: '2026-07-18T11:00:00Z'
        });

        expect(evaluateFirestoreRecoveryPosture(input)).toMatchObject({
            healthy: true,
            newestBackup: { name: demoBackupName }
        });
    });

    it('allows only the documented first-backup grace window, including its exact boundary', () => {
        const exactBoundary = healthyInput();
        exactBoundary.schedules[0].createTime = new Date(now - 36 * 60 * 60 * 1000).toISOString();
        exactBoundary.backups = [];
        expect(evaluateFirestoreRecoveryPosture(exactBoundary)).toMatchObject({
            healthy: true,
            notices: [expect.stringContaining('initial 36-hour window')]
        });

        const beyondBoundary = structuredClone(exactBoundary);
        beyondBoundary.schedules[0].createTime = new Date(now - 36 * 60 * 60 * 1000 - 1).toISOString();
        expect(evaluateFirestoreRecoveryPosture(beyondBoundary)).toMatchObject({
            healthy: false,
            failures: ['The daily schedule has not produced a ready backup within its initial 36-hour window.']
        });
    });

    it('allows ordinary clock skew but rejects a materially future schedule timestamp', () => {
        const skewed = healthyInput();
        skewed.backups = [];
        skewed.schedules[0].createTime = new Date(now + MAX_FUTURE_CLOCK_SKEW_MS).toISOString();
        expect(evaluateFirestoreRecoveryPosture(skewed)).toMatchObject({ healthy: true });

        const future = structuredClone(skewed);
        future.schedules[0].createTime = new Date(now + MAX_FUTURE_CLOCK_SKEW_MS + 1).toISOString();
        expect(evaluateFirestoreRecoveryPosture(future)).toMatchObject({
            healthy: false,
            failures: ['The daily managed-backup schedule creation timestamp is materially in the future.'],
            notices: []
        });
    });

    it('rejects missing, malformed, non-UTC, and impossible schedule timestamps', () => {
        for (const createTime of [
            undefined,
            'not-a-time',
            '2026-07-18',
            '2026-07-18T02:42:05-05:00',
            '2026-02-31T02:42:05Z'
        ]) {
            const input = healthyInput();
            input.backups = [];
            input.schedules[0].createTime = createTime;
            expect(evaluateFirestoreRecoveryPosture(input).failures).toContain(
                'The daily managed-backup schedule creation timestamp is missing or invalid.'
            );
        }
    });

    it('allows backup clock skew but rejects materially future backup timestamps', () => {
        const skewed = healthyInput();
        skewed.backups[0].snapshotTime = new Date(now + MAX_FUTURE_CLOCK_SKEW_MS).toISOString();
        expect(evaluateFirestoreRecoveryPosture(skewed)).toMatchObject({ healthy: true });

        const future = structuredClone(skewed);
        future.backups[0].snapshotTime = new Date(now + MAX_FUTURE_CLOCK_SKEW_MS + 1).toISOString();
        expect(evaluateFirestoreRecoveryPosture(future)).toMatchObject({
            healthy: false,
            failures: [`Backup ${demoBackupName} has a snapshot timestamp materially in the future.`],
            newestBackup: null
        });
    });

    it('fails a ready backup with a missing, malformed, non-UTC, or impossible timestamp', () => {
        for (const timestamp of [
            undefined,
            '',
            'not-a-time',
            '2026-07-18',
            '2026-07-18T06:00:00-05:00',
            '2026-02-31T06:00:00Z'
        ]) {
            const input = healthyInput();
            input.backups[0].snapshotTime = timestamp;
            expect(evaluateFirestoreRecoveryPosture(input).failures).toContain(
                `Ready backup ${demoBackupName} has a missing or invalid snapshot timestamp.`
            );
        }
    });

    it('never substitutes createTime for a missing ready-backup snapshotTime', () => {
        const input = healthyInput();
        input.schedules[0].createTime = '2026-07-16T00:00:00Z';
        delete input.backups[0].snapshotTime;
        input.backups[0].createTime = '2026-07-18T11:59:00Z';

        const result = evaluateFirestoreRecoveryPosture(input);
        expect(result.healthy).toBe(false);
        expect(result.failures).toEqual(expect.arrayContaining([
            `Ready backup ${demoBackupName} has a missing or invalid snapshot timestamp.`,
            'The daily schedule has not produced a ready backup within its initial 36-hour window.'
        ]));
        expect(result.newestBackup).toBeNull();
    });

    it.each([
        ['missing', undefined],
        ['malformed', 'not-a-time'],
        ['expired', '2026-07-18T11:59:59Z'],
        ['before next check', '2026-07-18T18:00:00Z']
    ])('rejects a ready backup whose expiration is %s', (_description, expireTime) => {
        const input = healthyInput();
        input.schedules[0].createTime = '2026-07-16T00:00:00Z';
        input.backups[0].expireTime = expireTime;

        const result = evaluateFirestoreRecoveryPosture(input);
        expect(result.healthy).toBe(false);
        expect(result.newestBackup).toBeNull();
        expect(result.failures).toContain(
            expireTime == null || expireTime === 'not-a-time'
                ? `Ready backup ${demoBackupName} has a missing or invalid expiration timestamp.`
                : `Ready backup ${demoBackupName} expires before the next six-hour health-check window.`
        );
    });

    it('requires a ready backup to name the exact database and canonical backup resource', () => {
        const wrongDatabase = healthyInput();
        wrongDatabase.expectedDatabaseName = demoDatabaseName;
        wrongDatabase.backups[0].database = 'projects/demo-project/databases/other';
        expect(evaluateFirestoreRecoveryPosture(wrongDatabase).failures).toContain(
            `Ready backup ${demoBackupName} does not belong to ${demoDatabaseName}.`
        );

        for (const name of [undefined, '', 'backup-1', 'projects/demo-project/locations/nam5/backups/not-a-uuid']) {
            const malformedName = healthyInput();
            malformedName.expectedDatabaseName = demoDatabaseName;
            malformedName.backups[0].name = name;
            expect(evaluateFirestoreRecoveryPosture(malformedName).failures).toContain(
                `Ready backup ${name || '<unnamed backup>'} has a missing or invalid canonical resource name.`
            );
        }
    });

    it('refuses a recreated production schedule instead of resetting initial grace', () => {
        const input = healthyInput();
        input.backups = [];
        input.schedules[0].name = `${EXPECTED_PRODUCTION_DAILY_SCHEDULE}-replacement`;
        input.schedules[0].createTime = new Date(now).toISOString();
        input.expectedDailyScheduleName = EXPECTED_PRODUCTION_DAILY_SCHEDULE;

        const result = evaluateFirestoreRecoveryPosture(input);
        expect(result.healthy).toBe(false);
        expect(result.failures).toContain(
            `The daily managed-backup schedule must be ${EXPECTED_PRODUCTION_DAILY_SCHEDULE}; refusing a recreated schedule that could reset the first-backup grace window.`
        );
    });

    it('pins the original production schedule creation time as well as its name', () => {
        const input = healthyInput();
        input.schedules[0].name = EXPECTED_PRODUCTION_DAILY_SCHEDULE;
        input.schedules[0].createTime = '2026-07-18T11:59:00Z';
        input.expectedDailyScheduleName = EXPECTED_PRODUCTION_DAILY_SCHEDULE;
        input.expectedDailyScheduleCreateTime = EXPECTED_PRODUCTION_DAILY_SCHEDULE_CREATE_TIME;

        expect(evaluateFirestoreRecoveryPosture(input).failures).toContain(
            `The daily managed-backup schedule creation time must remain ${EXPECTED_PRODUCTION_DAILY_SCHEDULE_CREATE_TIME}; refusing a replaced schedule or reset grace window.`
        );
    });

    it.each([false, true, '', 'daily', [], 0, 1, { unexpected: true }])
    ('rejects malformed dailyRecurrence metadata %j', (dailyRecurrence) => {
        const input = healthyInput();
        input.schedules[0].dailyRecurrence = dailyRecurrence;
        const result = evaluateFirestoreRecoveryPosture(input);
        expect(result.healthy).toBe(false);
        expect(result.failures).toContain('No daily managed-backup schedule exists.');
    });

    it('requires exact database and canonical schedule resource names when scoped', () => {
        const input = healthyInput();
        input.expectedDatabaseName = 'projects/demo-project/databases/(default)';
        input.database.name = 'projects/other-project/databases/(default)';
        input.schedules[0].name = 'projects/demo-project/databases/other/backupSchedules/daily';

        expect(evaluateFirestoreRecoveryPosture(input).failures).toEqual(expect.arrayContaining([
            'The database metadata name must be projects/demo-project/databases/(default).',
            'Every backup schedule must be a canonical child of projects/demo-project/databases/(default).'
        ]));
    });

    it('rejects a fresh backup from an older database incarnation', () => {
        const input = healthyInput();
        input.schedules[0].createTime = '2026-07-16T00:00:00Z';
        input.backups[0].databaseUid = retiredDatabaseUid;

        expect(evaluateFirestoreRecoveryPosture(input)).toMatchObject({
            healthy: false,
            failures: ['The daily schedule has not produced a ready backup within its initial 36-hour window.'],
            newestBackup: null
        });
    });

    it('treats old-incarnation backups as absent during the genuine initial grace window', () => {
        const input = healthyInput();
        input.schedules[0].createTime = '2026-07-18T02:42:05Z';
        input.backups[0].databaseUid = retiredDatabaseUid;

        expect(evaluateFirestoreRecoveryPosture(input)).toMatchObject({
            healthy: true,
            failures: [],
            notices: [expect.stringContaining('initial 36-hour window')],
            newestBackup: null
        });
    });

    it('fails closed when current database UID, response arrays, verifier clock, or direct age threshold is invalid', () => {
        const missingUid = healthyInput();
        delete missingUid.database.uid;
        expect(evaluateFirestoreRecoveryPosture(missingUid).failures).toContain(
            'The current database UID is unavailable or invalid, so backup lineage cannot be verified.'
        );

        const nonStringUid = healthyInput();
        nonStringUid.database.uid = 123;
        nonStringUid.backups[0].databaseUid = 123;
        expect(evaluateFirestoreRecoveryPosture(nonStringUid).failures).toContain(
            'The current database UID is unavailable or invalid, so backup lineage cannot be verified.'
        );

        const malformed = healthyInput();
        malformed.schedules = null;
        malformed.backups = {};
        malformed.now = Infinity;
        malformed.maxBackupAgeHours = Infinity;
        expect(evaluateFirestoreRecoveryPosture(malformed).failures).toEqual(expect.arrayContaining([
            'The verifier clock is invalid.',
            'Maximum backup age must be a finite number from 1 through 168 hours.',
            'Backup schedules response is not an array.',
            'Backups response is not an array.'
        ]));
    });
});

describe('Firestore recovery resource collection', () => {
    it('uses exact database resource equality before evaluating backups', () => {
        const database = healthyInput().database;
        database.name = demoDatabaseName;
        const schedules = healthyInput().schedules;
        schedules[0].name = demoScheduleName;
        const responses = [
            database,
            schedules,
            [
                {
                    ...healthyInput().backups[0],
                    database: 'projects/demo-project/databases/(default)'
                },
                {
                    ...healthyInput().backups[0],
                    name: 'suffix-collision',
                    snapshotTime: '2026-07-18T11:00:00Z',
                    database: 'projects/another-project/databases/(default)'
                }
            ]
        ];
        const calls = [];
        const runJson = (args) => {
            calls.push(args);
            return responses.shift();
        };

        const result = collectFirestoreRecoveryPosture({
            projectId: 'demo-project',
            databaseId: '(default)',
            maxBackupAgeHours: 36
        }, { runJson, now });

        expect(result).toMatchObject({ healthy: true, newestBackup: { name: demoBackupName } });
        expect(calls).toEqual([
            expect.arrayContaining(['firestore', 'databases', 'describe', '--project=demo-project', '--database=(default)']),
            expect.arrayContaining(['firestore', 'backups', 'schedules', 'list', '--project=demo-project', '--database=(default)']),
            expect.arrayContaining(['firestore', 'backups', 'list', '--project=demo-project'])
        ]);
    });

    it('throws an actionable failure for non-array gcloud list responses', () => {
        const runJson = (args) => args.includes('schedules') ? {} : healthyInput().database;
        expect(() => collectFirestoreRecoveryPosture({
            projectId: 'demo-project',
            databaseId: '(default)',
            maxBackupAgeHours: 36
        }, { runJson, now })).toThrow(/invalid backup schedules response.*JSON array/);
    });
});
