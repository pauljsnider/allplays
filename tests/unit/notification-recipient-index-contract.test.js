import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const notificationCore = require('../../functions/notification-target-index-core.cjs');

function extractBuildTargetsFromNotificationRecipientDoc() {
    const start = functionsSource.indexOf('function buildTargetsFromNotificationRecipientDoc(');
    const end = functionsSource.indexOf('\nasync function pruneInvalidTokens', start);
    const source = functionsSource.slice(start, end);
    return new Function(`${source}; return buildTargetsFromNotificationRecipientDoc;`)();
}

describe('notification recipient index foundation', () => {
    it('stores one denormalized recipient document per team user with category and token arrays', () => {
        expect(functionsSource).toContain('function buildTeamNotificationRecipientRef(teamId, uid');
        expect(functionsSource).toContain('return firestore.doc(`teams/${teamId}/notificationRecipients/${normalizedUid}`);');
        expect(functionsSource).toContain('await recipientRef.set({');
        expect(functionsSource).toContain('roles,');
        expect(functionsSource).toContain('categories: normalizeNotificationTargetCategories(preferences)');
        expect(functionsSource).toContain('tokens,');
        expect(functionsSource).toContain("firestore.collection(`teams/${teamId}/notificationRecipients`)");
        expect(functionsSource).toContain("where(`categories.${category}`, '==', true)");
        expect(functionsSource).toContain('buildTargetsFromNotificationRecipientDoc(docSnap');
    });

    it('keeps the recipient index in sync from preference, device, user, and team changes', () => {
        expect(functionsSource).toContain('exports.syncTeamNotificationRecipientsOnPreferenceWrite = functions.firestore');
        expect(functionsSource).toContain(".document('users/{uid}/notificationPreferences/{teamId}')");
        expect(functionsSource).toContain('exports.syncTeamNotificationRecipientsOnDeviceWrite = functions.firestore');
        expect(functionsSource).toContain(".document('users/{uid}/notificationDevices/{deviceId}')");
        expect(functionsSource).toContain('exports.syncTeamNotificationRecipientsOnUserWrite = functions.firestore');
        expect(functionsSource).toContain(".document('users/{uid}')");
        expect(functionsSource).toContain('exports.syncTeamNotificationRecipientsOnTeamWrite = functions.firestore');
        expect(functionsSource).toContain(".document('teams/{teamId}')");
    });

    it('falls back to live preference/device reads and backfills after empty indexed lookups', () => {
        expect(functionsSource).toContain('async function getTargetsForCategory(teamId, category');
        expect(functionsSource).toContain('function isAggregateNotificationRecipientDoc(docSnap) {');
        expect(functionsSource).toContain('const indexedRecipientDocs = (targetSnap.docs || []).filter(isAggregateNotificationRecipientDoc);');
        expect(functionsSource).toContain('const eligibleUsers = buildIndexedEligibleUsers(indexedRecipientDocs, category, audienceContext, additionalUsers);');
        expect(functionsSource).toContain('await teamNotificationRecipientIndexIsEmpty(teamId)');
        expect(functionsSource).toContain('some((docSnap) => isAggregateNotificationRecipientDoc(docSnap))');
        expect(functionsSource).toContain('await backfillNotificationRecipientsForTeam(teamId, users, { skipLegacyCleanup: true })');
        expect(functionsSource).toContain('const fallbackTargets = await getLegacyTargetsForCategory(teamId, category, users, actorUid, audienceContext);');
        expect(functionsSource).toContain('return fallbackTargets;');
    });

    it('deduplicates non-chat sends with a short-lived send log and records audit metadata', () => {
        expect(functionsSource).toContain('const NOTIFICATION_DEDUP_WINDOW_MS = 5 * 60 * 1000;');
        expect(functionsSource).toContain("firestore.doc(`teams/${teamId}/notificationSendLog/${hash}`)");
        expect(functionsSource).toContain('const canSend = await checkAndSetNotificationDedup(teamId, category, gameId, dedupKey);');
        expect(functionsSource).toContain("const ALWAYS_SEND_CATEGORIES = new Set(['liveScore', 'mentions', 'liveChat']);");
        expect(functionsSource).toContain('dedupGuardApplied: !ALWAYS_SEND_CATEGORIES.has(category)');
        expect(functionsSource).toContain('writeNotificationAuditRecord({');
    });

    it('normalizes every notification category into index payloads', () => {
        expect(notificationCore.NOTIFICATION_CATEGORIES).toEqual(expect.arrayContaining([
            'liveChat',
            'mentions',
            'schedule',
            'rsvp',
            'fees',
            'media',
            'awards'
        ]));

        expect(notificationCore.buildNotificationTargetPayload({
            uid: ' parent-1 ',
            teamId: ' team-1 ',
            deviceId: ' device-1 ',
            token: ' token-1 ',
            preferences: { fees: true, media: true }
        })).toMatchObject({
            uid: 'parent-1',
            teamId: 'team-1',
            deviceId: 'device-1',
            token: 'token-1',
            categories: expect.objectContaining({
                fees: true,
                media: true,
                mentions: true
            })
        });
    });

    it('hydrates indexed recipient docs into valid category targets only', () => {
        const buildTargetsFromNotificationRecipientDoc = extractBuildTargetsFromNotificationRecipientDoc();
        const eligibleUsers = new Map([
            ['parent-1', { uid: 'parent-1', roles: ['parent'] }]
        ]);
        const docSnap = {
            id: 'parent-1',
            data: () => ({
                uid: ' parent-1 ',
                categories: { fees: true, schedule: false },
                tokens: [
                    { deviceId: ' ios-1 ', token: ' token-1 ', platform: ' ios ', userAgent: ' AllPlays/1.0 ' },
                    { deviceId: 'blank-token', token: '   ', platform: 'web' }
                ]
            })
        };

        expect(buildTargetsFromNotificationRecipientDoc(docSnap, {
            teamId: 'team-1',
            category: 'fees',
            actorUid: 'staff-1',
            eligibleUsers
        })).toEqual([{
            uid: 'parent-1',
            deviceId: 'ios-1',
            token: 'token-1',
            teamId: 'team-1',
            platform: 'ios',
            userAgent: 'AllPlays/1.0'
        }]);
        expect(buildTargetsFromNotificationRecipientDoc(docSnap, {
            teamId: 'team-1',
            category: 'schedule',
            actorUid: 'staff-1',
            eligibleUsers
        })).toEqual([]);
        expect(buildTargetsFromNotificationRecipientDoc(docSnap, {
            teamId: 'team-1',
            category: 'fees',
            actorUid: 'parent-1',
            eligibleUsers
        })).toEqual([]);
    });
});
