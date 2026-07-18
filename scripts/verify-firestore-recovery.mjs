#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_DATABASE_ID = '(default)';
export const DEFAULT_MAX_BACKUP_AGE_HOURS = 36;
export const MAX_MAX_BACKUP_AGE_HOURS = 7 * 24;
export const MINIMUM_DAILY_RETENTION_SECONDS = 14 * 24 * 60 * 60;
export const MAX_FUTURE_CLOCK_SKEW_MS = 10 * 60 * 1000;
export const MINIMUM_BACKUP_REMAINING_HOURS = 6;
export const EXPECTED_PRODUCTION_PROJECT_ID = 'game-flow-c6311';
export const EXPECTED_PRODUCTION_DAILY_SCHEDULE = 'projects/game-flow-c6311/databases/(default)/backupSchedules/8a7f67fe-c6eb-4a4e-8a48-20e96e9fdf57';
export const EXPECTED_PRODUCTION_DAILY_SCHEDULE_CREATE_TIME = '2026-07-18T02:42:05.213778Z';

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATABASE_ID_PATTERN = /^(?:\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/;
const GOOGLE_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function durationSeconds(value) {
    const match = String(value || '').trim().match(/^(\d+(?:\.\d{1,9})?)s$/);
    if (!match) return null;

    const seconds = Number(match[1]);
    return Number.isFinite(seconds) ? seconds : null;
}

function timestampMillis(value) {
    if (typeof value !== 'string' || !GOOGLE_TIMESTAMP_PATTERN.test(value)) return null;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return null;

    const inputSecond = `${value.slice(0, 19)}Z`;
    const parsedSecond = `${new Date(parsed).toISOString().slice(0, 19)}Z`;
    return inputSecond === parsedSecond ? parsed : null;
}

function backupTimestamp(backup) {
    return timestampMillis(backup?.snapshotTime);
}

function finiteBoundedHours(value) {
    const hours = typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isFinite(hours) && hours >= 1 && hours <= MAX_MAX_BACKUP_AGE_HOURS
        ? hours
        : null;
}

function backupLabel(backup) {
    return String(backup?.name || '<unnamed backup>');
}

function isExactDailyRecurrence(value) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 0;
}

function isCanonicalScheduleName(name, expectedDatabaseName) {
    if (typeof name !== 'string' || typeof expectedDatabaseName !== 'string') return false;
    const prefix = `${expectedDatabaseName}/backupSchedules/`;
    if (!name.startsWith(prefix)) return false;
    const scheduleId = name.slice(prefix.length);
    return /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(scheduleId);
}

function isCanonicalBackupName(name, expectedDatabaseName) {
    if (typeof name !== 'string' || typeof expectedDatabaseName !== 'string') return false;
    const databaseMatch = expectedDatabaseName.match(/^projects\/([a-z][a-z0-9-]{4,28}[a-z0-9])\/databases\/(?:\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/);
    if (!databaseMatch) return false;
    const backupMatch = name.match(/^projects\/([a-z][a-z0-9-]{4,28}[a-z0-9])\/locations\/([a-z0-9-]+)\/backups\/([0-9a-f-]+)$/i);
    return backupMatch != null
        && backupMatch[1] === databaseMatch[1]
        && backupMatch[2].length > 0
        && UUID_V4_PATTERN.test(backupMatch[3]);
}

export function evaluateFirestoreRecoveryPosture({
    database,
    schedules = [],
    backups = [],
    now = Date.now(),
    maxBackupAgeHours = DEFAULT_MAX_BACKUP_AGE_HOURS,
    expectedDatabaseName = null,
    expectedDailyScheduleName = null,
    expectedDailyScheduleCreateTime = null
} = {}) {
    const failures = [];
    const notices = [];
    const nowMillis = Number(now);
    const boundedMaxBackupAgeHours = finiteBoundedHours(maxBackupAgeHours);

    if (!Number.isFinite(nowMillis) || nowMillis < 0) {
        failures.push('The verifier clock is invalid.');
    }
    if (boundedMaxBackupAgeHours == null) {
        failures.push(`Maximum backup age must be a finite number from 1 through ${MAX_MAX_BACKUP_AGE_HOURS} hours.`);
    }
    if (!Array.isArray(schedules)) {
        failures.push('Backup schedules response is not an array.');
        schedules = [];
    }
    if (!Array.isArray(backups)) {
        failures.push('Backups response is not an array.');
        backups = [];
    }

    if (database?.pointInTimeRecoveryEnablement !== 'POINT_IN_TIME_RECOVERY_ENABLED') {
        failures.push('Point-in-time recovery is not enabled.');
    }
    if (database?.deleteProtectionState !== 'DELETE_PROTECTION_ENABLED') {
        failures.push('Database delete protection is not enabled.');
    }
    if (expectedDatabaseName != null && database?.name !== expectedDatabaseName) {
        failures.push(`The database metadata name must be ${expectedDatabaseName}.`);
    }

    const currentDatabaseUid = typeof database?.uid === 'string' ? database.uid.trim() : '';
    if (!UUID_V4_PATTERN.test(currentDatabaseUid)) {
        failures.push('The current database UID is unavailable or invalid, so backup lineage cannot be verified.');
    }

    if (
        expectedDatabaseName != null
        && schedules.some((schedule) => !isCanonicalScheduleName(schedule?.name, expectedDatabaseName))
    ) {
        failures.push(`Every backup schedule must be a canonical child of ${expectedDatabaseName}.`);
    }

    const dailySchedules = schedules.filter((schedule) => isExactDailyRecurrence(schedule?.dailyRecurrence));
    if (dailySchedules.length === 0) {
        failures.push('No daily managed-backup schedule exists.');
    } else if (dailySchedules.length > 1) {
        failures.push('More than one daily managed-backup schedule exists; expected exactly one.');
    }
    const dailySchedule = dailySchedules[0] || null;

    if (
        expectedDailyScheduleName != null
        && dailySchedule?.name !== expectedDailyScheduleName
    ) {
        failures.push(`The daily managed-backup schedule must be ${expectedDailyScheduleName}; refusing a recreated schedule that could reset the first-backup grace window.`);
    }
    if (
        expectedDailyScheduleCreateTime != null
        && dailySchedule?.createTime !== expectedDailyScheduleCreateTime
    ) {
        failures.push(`The daily managed-backup schedule creation time must remain ${expectedDailyScheduleCreateTime}; refusing a replaced schedule or reset grace window.`);
    }

    if (dailySchedule) {
        const retentionSeconds = durationSeconds(dailySchedule.retention);
        if (retentionSeconds == null || retentionSeconds < MINIMUM_DAILY_RETENTION_SECONDS) {
            failures.push('The daily managed-backup retention is shorter than 14 days or invalid.');
        }
    }

    const usableNow = Number.isFinite(nowMillis) && nowMillis >= 0 ? nowMillis : null;
    const scheduleCreatedAt = timestampMillis(dailySchedule?.createTime);
    if (dailySchedule && scheduleCreatedAt == null) {
        failures.push('The daily managed-backup schedule creation timestamp is missing or invalid.');
    } else if (
        dailySchedule
        && usableNow != null
        && scheduleCreatedAt > usableNow + MAX_FUTURE_CLOCK_SKEW_MS
    ) {
        failures.push('The daily managed-backup schedule creation timestamp is materially in the future.');
    }

    const currentLineageBackups = UUID_V4_PATTERN.test(currentDatabaseUid)
        ? backups.filter((backup) => (
            typeof backup?.databaseUid === 'string'
            && backup.databaseUid.trim() === currentDatabaseUid
        ))
        : [];
    const validReadyBackups = [];

    for (const backup of currentLineageBackups) {
        if (backup?.state !== 'READY') continue;

        let validMetadata = true;
        if (!UUID_V4_PATTERN.test(String(backup?.databaseUid || '').trim())) {
            failures.push(`Ready backup ${backupLabel(backup)} has an invalid database UID.`);
            validMetadata = false;
        }
        if (expectedDatabaseName != null && backup?.database !== expectedDatabaseName) {
            failures.push(`Ready backup ${backupLabel(backup)} does not belong to ${expectedDatabaseName}.`);
            validMetadata = false;
        }
        if (expectedDatabaseName != null && !isCanonicalBackupName(backup?.name, expectedDatabaseName)) {
            failures.push(`Ready backup ${backupLabel(backup)} has a missing or invalid canonical resource name.`);
            validMetadata = false;
        }

        const capturedAt = backupTimestamp(backup);
        if (capturedAt == null) {
            failures.push(`Ready backup ${backupLabel(backup)} has a missing or invalid snapshot timestamp.`);
            validMetadata = false;
        }
        if (capturedAt != null && usableNow != null && capturedAt > usableNow + MAX_FUTURE_CLOCK_SKEW_MS) {
            failures.push(`Backup ${backupLabel(backup)} has a snapshot timestamp materially in the future.`);
            validMetadata = false;
        }

        const expiresAt = timestampMillis(backup?.expireTime);
        if (expiresAt == null) {
            failures.push(`Ready backup ${backupLabel(backup)} has a missing or invalid expiration timestamp.`);
            validMetadata = false;
        } else if (
            usableNow != null
            && expiresAt <= usableNow + MINIMUM_BACKUP_REMAINING_HOURS * 60 * 60 * 1000
        ) {
            failures.push(`Ready backup ${backupLabel(backup)} expires before the next six-hour health-check window.`);
            validMetadata = false;
        }

        if (validMetadata) {
            validReadyBackups.push({ backup, capturedAt });
        }
    }

    validReadyBackups.sort((left, right) => right.capturedAt - left.capturedAt);
    const newestBackup = validReadyBackups[0]?.backup || null;

    if (newestBackup) {
        const newestAt = validReadyBackups[0].capturedAt;
        if (
            usableNow != null
            && boundedMaxBackupAgeHours != null
            && usableNow - newestAt > boundedMaxBackupAgeHours * 60 * 60 * 1000
        ) {
            failures.push(`The newest ready backup is older than ${boundedMaxBackupAgeHours} hours.`);
        }
    } else if (dailySchedule && scheduleCreatedAt != null && usableNow != null) {
        const scheduleAgeMs = usableNow - scheduleCreatedAt;
        const graceMs = DEFAULT_MAX_BACKUP_AGE_HOURS * 60 * 60 * 1000;
        if (scheduleAgeMs < -MAX_FUTURE_CLOCK_SKEW_MS) {
            // The future-timestamp failure above is already the actionable cause.
        } else if (scheduleAgeMs > graceMs) {
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
    const separatedIndexes = argv
        .map((argument, index) => argument === name ? index : -1)
        .filter((index) => index >= 0);
    const prefix = `${name}=`;
    const assignments = argv.filter((argument) => String(argument).startsWith(prefix));

    if (separatedIndexes.length + assignments.length > 1) {
        throw new Error(`${name} may be supplied only once.`);
    }
    if (separatedIndexes.length === 1) {
        const value = argv[separatedIndexes[0] + 1];
        if (value == null || String(value).startsWith('--')) {
            throw new Error(`${name} requires a value.`);
        }
        return String(value).trim();
    }
    if (assignments.length === 1) return String(assignments[0]).slice(prefix.length).trim();
    return String(fallback ?? '').trim();
}

function validateKnownFlags(argv) {
    const known = new Set(['--project', '--database', '--max-backup-age-hours']);
    for (let index = 0; index < argv.length; index += 1) {
        const argument = String(argv[index]);
        const name = argument.split('=', 1)[0];
        if (!known.has(name)) throw new Error(`Unknown recovery verifier argument: ${argument}`);
        if (!argument.includes('=')) index += 1;
    }
}

export function parseFirestoreRecoveryArgs(argv = process.argv.slice(2), environment = process.env) {
    validateKnownFlags(argv);

    const projectId = readFlag(argv, '--project', environment.FIREBASE_PROJECT_ID || '');
    const databaseId = readFlag(argv, '--database', environment.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID);
    const maxBackupAgeValue = readFlag(
        argv,
        '--max-backup-age-hours',
        environment.FIRESTORE_MAX_BACKUP_AGE_HOURS || String(DEFAULT_MAX_BACKUP_AGE_HOURS)
    );
    const maxBackupAgeHours = finiteBoundedHours(maxBackupAgeValue);

    if (!projectId) {
        throw new Error('Set FIREBASE_PROJECT_ID or pass --project before checking Firestore recovery.');
    }
    if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error('The Firestore project ID is invalid.');
    }
    if (!DATABASE_ID_PATTERN.test(databaseId)) {
        throw new Error('The Firestore database ID is invalid.');
    }
    if (maxBackupAgeHours == null) {
        throw new Error(`--max-backup-age-hours must be a finite number from 1 through ${MAX_MAX_BACKUP_AGE_HOURS}.`);
    }

    return { projectId, databaseId, maxBackupAgeHours };
}

export function runGcloudJson(args) {
    try {
        const output = execFileSync('gcloud', args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'inherit'],
            timeout: 2 * 60 * 1000,
            maxBuffer: 10 * 1024 * 1024
        });
        return JSON.parse(output || 'null');
    } catch (error) {
        const command = args
            .filter((argument) => !String(argument).startsWith('--format='))
            .slice(0, 4)
            .join(' ');
        const reason = error?.code === 'ETIMEDOUT' ? ' The command timed out after two minutes.' : '';
        throw new Error(
            `gcloud ${command} failed.${reason} Verify Cloud SDK installation, OIDC authentication, project access, and the three recovery metadata permissions.`,
            { cause: error }
        );
    }
}

function requireArray(value, label) {
    if (!Array.isArray(value)) throw new Error(`gcloud returned an invalid ${label} response; expected a JSON array.`);
    return value;
}

export function collectFirestoreRecoveryPosture(
    { projectId, databaseId, maxBackupAgeHours },
    { runJson = runGcloudJson, now = Date.now() } = {}
) {
    const databaseName = `projects/${projectId}/databases/${databaseId}`;
    const database = runJson([
        'firestore', 'databases', 'describe',
        `--project=${projectId}`,
        `--database=${databaseId}`,
        '--format=json'
    ]);
    const schedules = requireArray(runJson([
        'firestore', 'backups', 'schedules', 'list',
        `--project=${projectId}`,
        `--database=${databaseId}`,
        '--format=json'
    ]), 'backup schedules');
    const backups = requireArray(runJson([
        'firestore', 'backups', 'list',
        `--project=${projectId}`,
        '--format=json'
    ]), 'backups').filter((backup) => String(backup?.database || '') === databaseName);

    return evaluateFirestoreRecoveryPosture({
        database,
        schedules,
        backups,
        now,
        maxBackupAgeHours,
        expectedDatabaseName: databaseName,
        expectedDailyScheduleName: (
            projectId === EXPECTED_PRODUCTION_PROJECT_ID
            && databaseId === DEFAULT_DATABASE_ID
        ) ? EXPECTED_PRODUCTION_DAILY_SCHEDULE : null,
        expectedDailyScheduleCreateTime: (
            projectId === EXPECTED_PRODUCTION_PROJECT_ID
            && databaseId === DEFAULT_DATABASE_ID
        ) ? EXPECTED_PRODUCTION_DAILY_SCHEDULE_CREATE_TIME : null
    });
}

export function verifyFirestoreRecovery(
    argv = process.argv.slice(2),
    environment = process.env,
    dependencies = {}
) {
    const options = parseFirestoreRecoveryArgs(argv, environment);
    const result = collectFirestoreRecoveryPosture(options, dependencies);

    console.log(JSON.stringify({
        projectId: options.projectId,
        databaseId: options.databaseId,
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
