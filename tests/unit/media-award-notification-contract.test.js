import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const firestoreIndexes = readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8');

describe('media and award notification contract', () => {
    it('queues team-visible media items into hourly notification batches', () => {
        expect(functionsSource).toContain('const TEAM_MEDIA_NOTIFICATION_BATCH_WINDOW_MS = 60 * 60 * 1000;');
        expect(functionsSource).toContain('function buildTeamMediaNotificationBatchMetadata({ teamId, itemId, item = {}, folder = {}, now = new Date() } = {})');
        expect(functionsSource).toContain("if (!normalizedTeamId || !normalizedItemId || !folderId || item.deleted === true) return null;");
        expect(functionsSource).toContain("if (albumVisibility !== 'team') return null;");
        expect(functionsSource).toContain('batchId: buildTeamMediaNotificationBatchId(normalizedTeamId, folderId, windowStartAt)');
        expect(functionsSource).toContain('windowStartAt,');
        expect(functionsSource).toContain('dueAt');
        expect(functionsSource).toContain("transaction.set(batchRef, buildTeamMediaNotificationBatchWrite(batch, metadata), { merge: true });");
        expect(functionsSource).toContain('exports.queueTeamMediaNotificationBatch = functions.firestore');
        expect(functionsSource).toContain(".document('teams/{teamId}/mediaItems/{itemId}')");
    });

    it('dispatches due media batches with current visibility re-checks and media dedup keys', () => {
        expect(functionsSource).toContain('async function dispatchDueTeamMediaNotificationBatches(now = new Date())');
        expect(functionsSource).toContain("firestore.collection('teamMediaNotificationBatches')");
        expect(functionsSource).toContain(".where('status', '==', 'pending')");
        expect(functionsSource).toContain(".where('dueAt', '<=', admin.firestore.Timestamp.fromDate(now))");
        expect(functionsSource).toContain('const batch = await claimTeamMediaNotificationBatch(batchRef, claimId, now);');
        expect(functionsSource).toContain('await markTeamMediaNotificationBatchSkipped(batchRef, claimId, \'album_not_found\');');
        expect(functionsSource).toContain('await markTeamMediaNotificationBatchSkipped(batchRef, claimId, \'album_not_team_visible\');');
        expect(functionsSource).toContain("category: 'media'");
        expect(functionsSource).toContain('dedupKey: `team-media:${batch.id}`');
        expect(functionsSource).toContain('audienceContext: { albumVisibility }');
        expect(functionsSource).toContain('exports.dispatchDueTeamMediaNotificationBatches = functions.pubsub');
        expect(firestoreIndexes).toContain('"collectionGroup": "teamMediaNotificationBatches"');
        expect(firestoreIndexes).toContain('"fieldPath": "status"');
        expect(firestoreIndexes).toContain('"fieldPath": "dueAt"');
    });

    it('claims and sends published award notifications to linked parents only once', () => {
        expect(functionsSource).toContain('exports.notifyPublishedCertificateAward = functions.firestore');
        expect(functionsSource).toContain(".document('teams/{teamId}/certificates/{certificateId}')");
        expect(functionsSource).toContain("String(afterData.status || '').trim() === 'published'");
        expect(functionsSource).toContain('const claimed = await claimPublishedCertificateAwardNotification(change.after.ref, eventId);');
        expect(functionsSource).toContain('const parentUserIds = await resolvePublishedCertificateParentUserIds(teamId, afterData);');
        expect(functionsSource).toContain("getTargetsForCategory(\n      teamId,\n      'awards'");
        expect(functionsSource).toContain('parentUserIds.map((uid) => ({ uid, roles: [\'parent\'] }))');
        expect(functionsSource).toContain("category: 'awards'");
        expect(functionsSource).toContain('title: `Award published for ${playerName}`');
        expect(functionsSource).toContain('await markPublishedCertificateAwardNotificationProcessed(change.after.ref, eventId);');
    });

    it('routes awards and media notifications to the native app surfaces', () => {
        expect(functionsSource).toContain('function buildAwardNotificationDestination({ teamId, certificateId })');
        expect(functionsSource).toContain('appRoute: `/parent-tools/certificates${query ? `?${query}` : \'\'}`');
        expect(functionsSource).toContain("if (category === 'media') {");
        expect(functionsSource).toContain('return `/teams/${encodeURIComponent(teamId)}/media`;');
        expect(functionsSource).toContain('return `https://allplays.ai/app/#/teams/${encodeURIComponent(teamId)}/media`;');
    });
});
