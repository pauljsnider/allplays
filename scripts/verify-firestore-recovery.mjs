#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_DATABASE_ID = '(default)';
const DEFAULT_MAX_BACKUP_AGE_HOURS = 36;
const MINIMUM_DAILY_RETENTION_SECONDS = 14 * 24 * 60 * 60;

function durationSeconds(value) {
    const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)s$/);
    return match ? Number(match[1]) : 0;
}

function timestampMillis(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

export function evaluateFirestoreRecoveryPosture({
    database,
    schedules = [],
    backups = [],
    now = Date.now(),
    maxBackupAgeHours = DEFAULT_MAX_BACKUP_AGE_HOURS
} = {}) {
    const failures = [];
    const notices = [];

    if (database?.pointInTimeRecoveryEnablement !== 'POINT_IN_TIME_RECOVERY_ENABLED') {
        failures.push('Point-in-time recovery is not enabled.');
    }
    if (database?.deleteProtectionState !== 'DELETE_PROTECTION_ENABLED') {
        failures.push('Database delete protection is not enabled.');
    }

    const currentDatabaseUid = String(database?.uid || '').trim();
    if (!currentDatabaseUid) {
        failures.push('The current database UID is unavailable, so backup lineage cannot be verified.');
    }

    const dailySchedule = schedules.find((schedule) => schedule?.dailyRecurrence != null);
    if (!dailySchedule) {
        failures.push('No daily managed-backup schedule exists.');
    } else if (durationSeconds(dailySchedule.retention) < MINIMUM_DAILY_RETENTION_SECONDS) {
        failures.push('The daily managed-backup retention is shorter than 14 days.');
    }

    const readyBackups = backups
        .filter((backup) => (
            currentDatabaseUid
            && String(backup?.databaseUid || '').trim() === currentDatabaseUid
            && (!backup?.state || backup.state === 'READY')
        ))
        .sort((left, right) => timestampMillis(right.snapshotTime || right.createTime) - timestampMillis(left.snapshotTime || left.createTime));
    const newestBackup = readyBackups[0] || null;

    if (newestBackup) {
        const newestAt = timestampMillis(newestBackup.snapshotTime || newestBackup.createTime);
        const maximumAgeMs = Math.max(1, Number(maxBackupAgeHours) || DEFAULT_MAX_BACKUP_AGE_HOURS) * 60 * 60 * 1000;
        if (!newestAt || now - newestAt > maximumAgeMs) {
            failures.push(`The newest ready backup is older than ${maxBackupAgeHours} hours.`);
        }
    } else if (dailySchedule) {
        const scheduleAgeMs = now - timestampMillis(dailySchedule.createTime);
        if (!timestampMillis(dailySchedule.createTime) || scheduleAgeMs > DEFAULT_MAX_BACKUP_AGE_HOURS * 60 * 60 * 1000) {
            failures.push('The daily schedule has not produced a ready backup within its initial 36-hour window.');
        } else {
            notices.push('Daily schedule is within its initial 36-hour window; the first backup is still pending.');
        }
    }

    return {
        healthy: failures.length === 0,
        failures,
        notices,
        dailySchedule,
        newestBackup
    };
}

function readFlag(argv, name, fallback) {
    const index = argv.indexOf(name);
    if (index >= 0) return String(argv[index + 1] || '').trim();

    const prefix = `${name}=`;
    const assignment = argv.find((argument) => String(argument).startsWith(prefix));
    return assignment == null ? fallback : String(assignment).slice(prefix.length).trim();
}

function runGcloudJson(args) {
    try {
        const output = execFileSync('gcloud', args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'inherit']
        });
        return JSON.parse(output || 'null');
    } catch (error) {
        const command = args.filter((arg) => !String(arg).startsWith('--format=')).slice(0, 4).join(' ');
        throw new Error(
            `gcloud ${command} failed. Verify Cloud SDK installation, authentication, project access, and Firestore permissions.`,
            { cause: error }
        );
    }
}

export function parseFirestoreRecoveryArgs(argv = process.argv.slice(2), environment = process.env) {
    const projectId = readFlag(argv, '--project', environment.FIREBASE_PROJECT_ID || '');
    if (!projectId) {
        throw new Error('Set FIREBASE_PROJECT_ID or pass --project before checking Firestore recovery.');
    }
    return {
        projectId,
        databaseId: readFlag(argv, '--database', environment.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID),
        maxBackupAgeHours: Number(readFlag(
            argv,
            '--max-backup-age-hours',
            environment.FIRESTORE_MAX_BACKUP_AGE_HOURS || String(DEFAULT_MAX_BACKUP_AGE_HOURS)
        ))
    };
}

export function verifyFirestoreRecovery(argv = process.argv.slice(2)) {
    const { projectId, databaseId, maxBackupAgeHours } = parseFirestoreRecoveryArgs(argv);

    const database = runGcloudJson([
        'firestore', 'databases', 'describe',
        `--project=${projectId}`,
        `--database=${databaseId}`,
        '--format=json'
    ]);
    const schedules = runGcloudJson([
        'firestore', 'backups', 'schedules', 'list',
        `--project=${projectId}`,
        `--database=${databaseId}`,
        '--format=json'
    ]);
    const backups = runGcloudJson([
        'firestore', 'backups', 'list',
        `--project=${projectId}`,
        '--format=json'
    ]).filter((backup) => String(backup?.database || '').endsWith(`/databases/${databaseId}`));

    const result = evaluateFirestoreRecoveryPosture({
        database,
        schedules,
        backups,
        maxBackupAgeHours
    });

    console.log(JSON.stringify({
        projectId,
        databaseId,
        healthy: result.healthy,
        failures: result.failures,
        notices: result.notices,
        dailySchedule: result.dailySchedule?.name || null,
        newestBackup: result.newestBackup?.name || null
    }, null, 2));

    if (!result.healthy) process.exitCode = 1;
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        verifyFirestoreRecovery();
    } catch (error) {
        console.error(error?.message || 'Firestore recovery verification failed.');
        process.exitCode = 1;
    }
}
