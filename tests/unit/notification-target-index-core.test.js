import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
    buildNotificationTargetDocId,
    buildNotificationTargetPayload,
    hasEnabledNotificationCategory,
    normalizeNotificationTargetCategories,
    notificationAudienceAllowsRoles
} = require('../../functions/notification-target-index-core.cjs');
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('notification target index core helpers', () => {
    it('normalizes category booleans for every supported notification type', () => {
        expect(normalizeNotificationTargetCategories({ liveScore: true, schedule: 'yes' })).toMatchObject({
            liveChat: false,
            mentions: true,
            liveScore: true,
            gameDay: false,
            schedule: false,
            rsvp: true,
            fees: true,
            practice: false,
            access: true,
            rideshare: true,
            media: false,
            awards: false,
            officiating: false
        });
    });

    it('detects whether any push category remains enabled', () => {
        expect(hasEnabledNotificationCategory({ liveChat: false, liveScore: false, schedule: false })).toBe(false);
        expect(hasEnabledNotificationCategory({ liveChat: false, liveScore: true, schedule: false })).toBe(true);
    });

    it('builds stable target payloads and doc ids from user devices', () => {
        expect(buildNotificationTargetDocId({ uid: 'user-1', deviceId: 'device/1' })).toBe('user-1__device_1');
        expect(buildNotificationTargetDocId({ uid: '   ', deviceId: 'device-1' })).toBe('');
        expect(buildNotificationTargetDocId({ uid: 'user-1', deviceId: '!!!' })).toBe('');
        expect(buildNotificationTargetPayload({
            uid: 'user-1',
            teamId: 'team-1',
            deviceId: 'device-1',
            token: 'token-1',
            platform: 'ios',
            userAgent: 'AllPlays/1.0',
            preferences: { liveChat: true, liveScore: false, schedule: true }
        })).toEqual({
            uid: 'user-1',
            teamId: 'team-1',
            deviceId: 'device-1',
            token: 'token-1',
            platform: 'ios',
            userAgent: 'AllPlays/1.0',
            categories: {
                liveChat: true,
                mentions: true,
                liveScore: false,
                gameDay: false,
                schedule: true,
                rsvp: true,
                fees: true,
                practice: false,
                access: true,
                rideshare: true,
                media: false,
                awards: false,
                officiating: false
            }
        });
    });

    it('keeps access and officiating available to parents and staff', () => {
        expect(notificationAudienceAllowsRoles('access', ['parent'])).toBe(true);
        expect(notificationAudienceAllowsRoles('access', ['staff'])).toBe(true);
        expect(notificationAudienceAllowsRoles('officiating', ['parent'])).toBe(true);
        expect(notificationAudienceAllowsRoles('officiating', ['staff'])).toBe(true);
        expect(notificationAudienceAllowsRoles('fees', ['parent'])).toBe(true);
    });

    it('guards indexed writes by current team access before syncing targets', () => {
        const syncSource = functionsSource.slice(
            functionsSource.indexOf('async function getNotificationTargetTeamAccessMap'),
            functionsSource.indexOf('exports.syncTeamNotificationTargetsOnPreferenceWrite')
        );

        expect(syncSource).toContain('teamAccessMap.get(teamId) !== true');
        expect(syncSource).toContain('teamAccessMap.get(prefSnap.id) !== true');
        expect(syncSource).toContain('hasParentAccess || hasTeamAdminAccess');
        expect(syncSource).toContain('buildTeamNotificationIndexRefs');
        expect(syncSource).toContain('indexRefs.forEach((ref) => batch.set(ref, payload, { merge: true }))');
        expect(syncSource).toContain('indexRefs.forEach((ref) => batch.delete(ref));');
    });

    it('uses team recipient indexes and repairs partial coverage through bounded fallback', () => {
        const targetResolverSource = functionsSource.slice(
            functionsSource.indexOf('async function getLegacyTargetsForCategory'),
            functionsSource.indexOf('async function pruneInvalidTokens')
        );

        expect(targetResolverSource).toContain("firestore.collection(`teams/${teamId}/notificationRecipients`)");
        expect(targetResolverSource).toContain("where(`categories.${category}`, '==', true)");
        expect(targetResolverSource).toContain('if (!uid || uid === actorUid || !eligibleUsers.has(uid)) return [];');
        expect(targetResolverSource).toContain('if (data.categories && data.categories[category] !== true) return [];');
        expect(targetResolverSource).toContain('users/${uid}/notificationPreferences/${teamId}');
        expect(targetResolverSource).toContain('users/${uid}/notificationDevices');
        expect(targetResolverSource).toContain('if (!NOTIFICATION_CATEGORIES.includes(category)) return []');
        expect(targetResolverSource).toContain('canReceiveCategoryNotification(category, user, audienceContext)');
        expect(targetResolverSource).toContain('function isAggregateNotificationRecipientDoc(docSnap) {');
        expect(targetResolverSource).toContain('return Array.isArray(data.roles) || Array.isArray(data.tokens);');
        expect(targetResolverSource).toContain('const categoryRecipientDocs = targetSnap.docs || [];');
        expect(targetResolverSource).toContain('const indexedRecipientDocs = categoryRecipientDocs.filter(isAggregateNotificationRecipientDoc);');
        expect(targetResolverSource).toContain('const explicitlyEligibleLegacyRecipientDocs = categoryRecipientDocs.filter((docSnap) => (');
        expect(targetResolverSource).toContain('if (indexedRecipientDocs.length) {');
        expect(targetResolverSource).toContain('resolveMixedNotificationRecipientIndex({');
        expect(targetResolverSource).toContain('const coverageUserIds = Array.from(eligibleUsers.keys())');
        expect(targetResolverSource).toContain('await firestore.getAll(...recipientRefs)');
        expect(targetResolverSource).toContain('Failed to backfill missing notification recipient index entries');
        expect(functionsSource).toContain("const albumVisibility = audienceContext?.staffOnly === true");
        expect(functionsSource).toContain("return ['private', 'staff', 'staff-only'].includes(normalized) ? 'private' : 'team';");
        expect(functionsSource).toContain('if (hasMediaAudienceConstraints(audienceContext))');
        expect(functionsSource).toContain('return mediaAudienceAllowsUser(user, audienceContext);');
        expect(functionsSource).toContain("const isStaffUser = Array.isArray(user.roles) && user.roles.includes('staff');");
        expect(targetResolverSource).toContain('teamNotificationRecipientIndexIsEmpty(teamId)');
        expect(functionsSource).toContain('some((docSnap) => isAggregateNotificationRecipientDoc(docSnap))');
        expect(targetResolverSource).toContain('if (!indexIsEmpty) {');
        expect(targetResolverSource).toContain("await backfillNotificationRecipientsForTeam(teamId, users, { skipLegacyCleanup: true });");
        expect(targetResolverSource).toContain('getLegacyTargetsForCategory(teamId, category, users, actorUid, audienceContext)');
        expect(functionsSource).toContain('buildTeamNotificationTargetRef(target.teamId, target.uid, target.deviceId)');
        expect(functionsSource).toContain('pruneInvalidNotificationRecipientTokens(invalidTargets)');
    });

    it('uses indexed recipient docs before fallback reads for explicit user-id target resolution', () => {
        const userIdResolverSource = functionsSource.slice(
            functionsSource.indexOf('async function getTargetsForCategoryUserIds'),
            functionsSource.indexOf('function buildTargetsFromNotificationRecipientDoc')
        );

        expect(userIdResolverSource).toContain('Array.from(eligibleUsers.keys())');
        expect(userIdResolverSource).toContain('buildTeamNotificationRecipientRef(teamId, uid)');
        expect(userIdResolverSource).toContain('firestore.getAll(...recipientRefs)');
        expect(userIdResolverSource).toContain('buildTargetsFromNotificationRecipientDoc(docSnap');
        expect(userIdResolverSource).toContain('const indexedUserIds = new Set(indexedTargets.map((target) => target.uid));');
        expect(userIdResolverSource).toContain('const existingIndexedUserIds = new Set(recipientSnaps');
        expect(userIdResolverSource).toContain('!existingIndexedUserIds.has(user.uid)');
        expect(userIdResolverSource).toContain('const tokenlessIndexedTargets = recipientSnaps');
        expect(userIdResolverSource).toContain('eligibleUsers.has(user.uid)');
        expect(userIdResolverSource).toContain('? await getLegacyTargetsForCategory(teamId, category, missingUsers, actorUid, audienceContext)');
        expect(userIdResolverSource).toContain('return [...indexedTargets, ...tokenlessIndexedTargets, ...fallbackTargets].filter');
        expect(userIdResolverSource).toContain('if (!recipientUserIds.has(uid)) return false;');
    });
});
