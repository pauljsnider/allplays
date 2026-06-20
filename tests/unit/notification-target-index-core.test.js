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
            rideshare: false,
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
                rideshare: false,
                media: false,
                awards: false,
                officiating: false
            }
        });
    });

    it('filters staff-only notification categories out of parent-only targets', () => {
        expect(notificationAudienceAllowsRoles('access', ['parent'])).toBe(false);
        expect(notificationAudienceAllowsRoles('access', ['staff'])).toBe(true);
        expect(notificationAudienceAllowsRoles('officiating', ['parent'])).toBe(false);
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

    it('uses the team recipient index first and falls back to legacy user scans for missing indexed recipients', () => {
        const targetResolverSource = functionsSource.slice(
            functionsSource.indexOf('async function getLegacyTargetsForCategory'),
            functionsSource.indexOf('async function pruneInvalidTokens')
        );

        expect(targetResolverSource).toContain("firestore.collection(`teams/${teamId}/notificationRecipients`)");
        expect(targetResolverSource).toContain("where(`categories.${category}`, '==', true)");
        expect(targetResolverSource).toContain('if (!uid || uid === actorUid || !eligibleUsers.has(uid)) return [];');
        expect(targetResolverSource).toContain('users/${uid}/notificationPreferences/${teamId}');
        expect(targetResolverSource).toContain('users/${uid}/notificationDevices');
        expect(targetResolverSource).toContain('if (!NOTIFICATION_CATEGORIES.includes(category)) return []');
        expect(targetResolverSource).toContain('canReceiveCategoryNotification(category, user, audienceContext)');
        expect(functionsSource).toContain("const albumVisibility = audienceContext?.staffOnly === true");
        expect(functionsSource).toContain("return ['private', 'staff', 'staff-only'].includes(normalized) ? 'private' : 'team';");
        expect(functionsSource).toContain("if (albumVisibility !== 'private') return true;");
        expect(functionsSource).toContain("return Array.isArray(user.roles) && user.roles.includes('staff');");
        expect(targetResolverSource).toContain('const missingUsers = users.filter');
        expect(targetResolverSource).toContain('teamNotificationRecipientIndexIsEmpty(teamId)');
        expect(targetResolverSource).toContain('if (targetSnap.empty && await teamNotificationRecipientIndexIsEmpty(teamId))');
        expect(targetResolverSource).toContain("await backfillNotificationRecipientsForTeam(teamId, users, { skipLegacyCleanup: true });");
        expect(targetResolverSource).toContain('getLegacyTargetsForCategory(teamId, category, missingUsers, actorUid, audienceContext)');
        expect(functionsSource).toContain('buildTeamNotificationTargetRef(target.teamId, target.uid, target.deviceId)');
    });
});
