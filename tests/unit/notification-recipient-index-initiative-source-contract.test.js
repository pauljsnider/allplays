import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const firestoreRules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const migrationSource = readFileSync(new URL('../../_migration/backfill-notification-recipients.js', import.meta.url), 'utf8');

describe('notification recipient index initiative source contract', () => {
    it('resolves category sends through the denormalized notificationRecipients index first', () => {
        expect(functionsSource).toContain('function buildTeamNotificationRecipientRef(teamId, uid, deviceId)');
        expect(functionsSource).toContain('async function getTargetsForCategory(teamId, category, actorUid = null, audienceContext = {}, additionalUsers = [])');
        expect(functionsSource).toContain('firestore.collection(`teams/${teamId}/notificationRecipients`)');
        expect(functionsSource).toContain(".where(`categories.${category}`, '==', true)");
    });

    it('keeps a migration fallback that backfills the index when a team has no indexed recipients yet', () => {
        expect(functionsSource).toContain('async function backfillNotificationRecipientsForTeam(teamId, users, options = {})');
        expect(functionsSource).toContain('const indexIsEmpty = typeof teamNotificationRecipientIndexIsEmpty === \'function\'');
        expect(functionsSource).toContain('if (!indexIsEmpty) {');
        expect(functionsSource).toContain('await backfillNotificationRecipientsForTeam(teamId, users, { skipLegacyCleanup: true });');
        expect(functionsSource).toContain('Failed to backfill notification recipient index after empty lookup');
    });

    it('ships a migration script for seeding existing team recipient indexes', () => {
        expect(migrationSource).toContain("db.doc(`teams/${teamId}/notificationRecipients/${uid}`)");
        expect(migrationSource).toContain('normalizeNotificationTargetCategories(preferences)');
        expect(migrationSource).toContain("db.collection('users')");
        expect(migrationSource).toContain("'parentTeamIds', 'array-contains', teamId");
        expect(migrationSource).toContain('admin.auth().getUserByEmail(email)');
        expect(migrationSource).toContain('--dry-run');
    });

    it('deduplicates logical sends through a server-only notificationSendLog', () => {
        expect(functionsSource).toContain('function buildNotificationDedupRef(teamId, category, dedupIdentity = \'\')');
        expect(functionsSource).toContain('teams/${teamId}/notificationSendLog/${hash}');
        expect(functionsSource).toContain('async function checkAndSetNotificationDedup(teamId, category, gameId, dedupKey = null)');
        expect(functionsSource).toContain('Notification dedup: skipping duplicate send');
    });

    it('denies client reads and writes to recipient index and dedup log collections', () => {
        expect(firestoreRules).toMatch(/match \/notificationRecipients\/\{uid\} \{[\s\S]*allow read, write: if false;/);
        expect(firestoreRules).toMatch(/match \/notificationSendLog\/\{docId\} \{[\s\S]*allow read, write: if false;/);
    });
});
