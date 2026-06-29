import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    NOTIFICATION_INBOX_MAX_ITEMS,
    buildNotificationInboxPayload,
    getUniqueNotificationInboxTargets
} = require('../../functions/notification-inbox-core.cjs');

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const rulesSource = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const appNotificationInboxServiceSource = readFileSync(new URL('../../apps/app/src/lib/notificationInboxService.ts', import.meta.url), 'utf8');

describe('notification inbox pipeline', () => {
    it('builds bounded inbox payloads with the required notification center fields', () => {
        const payload = buildNotificationInboxPayload({
            category: 'schedule',
            title: '  Schedule update  ',
            body: 'Game moved to Field 2',
            appRoute: '/schedule/team-1/game-1',
            teamId: 'team-1',
            gameId: 'game-1',
            conversationId: 'staff',
            createdAt: 'server-time',
            readAt: null
        });

        expect(payload).toEqual({
            category: 'schedule',
            title: 'Schedule update',
            body: 'Game moved to Field 2',
            appRoute: '/schedule/team-1/game-1',
            teamId: 'team-1',
            gameId: 'game-1',
            eventId: null,
            conversationId: 'staff',
            createdAt: 'server-time',
            readAt: null
        });
    });

    it('deduplicates inbox targets so multi-device users receive one inbox record', () => {
        expect(getUniqueNotificationInboxTargets([
            { uid: 'user-1', deviceId: 'ios' },
            { uid: 'user-1', deviceId: 'web' },
            { uid: 'user-2', deviceId: 'android' },
            { uid: '', deviceId: 'empty' },
            null
        ])).toEqual([
            { uid: 'user-1', deviceId: 'ios' },
            { uid: 'user-2', deviceId: 'android' }
        ]);
    });

    it('wires inbox writes and cleanup into both notification send paths', () => {
        expect(NOTIFICATION_INBOX_MAX_ITEMS).toBe(50);
        expect(functionsSource).toContain('async function writeNotificationInboxRecords');
        expect(functionsSource).toContain("firestore.collection(`users/${target.uid}/notificationInbox`)");
        expect(functionsSource).toContain('conversationId,');
        expect(functionsSource).toContain('.limit(NOTIFICATION_INBOX_MAX_ITEMS + 1)');
        expect(functionsSource).not.toContain('.offset(NOTIFICATION_INBOX_MAX_ITEMS)');
        expect(functionsSource.match(/const inboxResult = await writeNotificationInboxRecords\(\{/g)).toHaveLength(2);
        expect(functionsSource.match(/inboxWriteCount: inboxResult.writeCount/g)).toHaveLength(2);
        expect(functionsSource.match(/inboxCleanupCount: inboxResult.cleanupCount/g)).toHaveLength(2);
        expect(functionsSource.match(/inboxFailureCount: inboxResult.failureCount/g)).toHaveLength(2);
    });

    it('exposes authenticated callable functions for individual and mark-all read state updates', () => {
        expect(functionsSource).toContain('exports.markNotificationInboxItemRead = functions.https.onCall');
        expect(functionsSource).toContain('throw new functions.https.HttpsError(\'unauthenticated\', \'Sign in before updating notification inbox items.\');');
        expect(functionsSource).toContain("firestore.doc(`users/${uid}/notificationInbox/${itemId}`)");
        expect(functionsSource).toContain('readAt: admin.firestore.FieldValue.serverTimestamp()');
        expect(functionsSource).toContain('exports.markAllNotificationInboxRead = functions.https.onCall');
        expect(functionsSource).toContain(".where('readAt', '==', null)");
        expect(functionsSource).toContain('.limit(NOTIFICATION_INBOX_MAX_ITEMS)');
        expect(appNotificationInboxServiceSource).toContain("httpsCallable(functions, 'markAllNotificationInboxRead')");
        expect(appNotificationInboxServiceSource).toContain("conversationId: getStringField(data, 'conversationId')");
        expect(appNotificationInboxServiceSource).not.toContain('writeBatch(db)');
        expect(appNotificationInboxServiceSource).toContain("from './logger'");
        expect(appNotificationInboxServiceSource).not.toContain('console.');
    });

    it('keeps notification inbox records owner-readable and server-writable only', () => {
        const inboxRules = rulesSource.slice(
            rulesSource.indexOf('match /notificationInbox/{itemId}'),
            rulesSource.indexOf('match /privateAiMessages/{messageId}')
        );

        expect(inboxRules).toContain('allow read: if isOwner(userId);');
        expect(inboxRules).toContain('allow create, update, delete: if false;');
        expect(inboxRules).not.toContain('isGlobalAdmin()');
        expect(inboxRules).not.toContain('allow write');
    });
});
