import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
    buildNotificationTargetDocId,
    buildNotificationTargetPayload,
    hasEnabledNotificationCategory,
    normalizeNotificationTargetCategories
} = require('../../functions/notification-target-index-core.cjs');
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('notification target index core helpers', () => {
    it('normalizes category booleans for every supported notification type', () => {
        expect(normalizeNotificationTargetCategories({ liveScore: true, schedule: 'yes' })).toEqual({
            liveChat: false,
            liveScore: true,
            schedule: false
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
                liveScore: false,
                schedule: true
            }
        });
    });

    it('guards indexed writes by current team access before syncing targets', () => {
        const syncSource = functionsSource.slice(
            functionsSource.indexOf('async function getNotificationTargetTeamAccessMap'),
            functionsSource.indexOf('exports.syncTeamNotificationTargetsOnPreferenceWrite')
        );

        expect(syncSource).toContain('teamAccessMap.get(teamId) !== true');
        expect(syncSource).toContain('teamAccessMap.get(prefSnap.id) !== true');
        expect(syncSource).toContain('hasParentAccess || hasTeamAdminAccess');
    });

    it('uses the team target index first and falls back to legacy user scans for missing indexed recipients', () => {
        const targetResolverSource = functionsSource.slice(
            functionsSource.indexOf('async function getLegacyTargetsForCategory'),
            functionsSource.indexOf('async function pruneInvalidTokens')
        );

        expect(targetResolverSource).toContain("firestore.collection(`teams/${teamId}/notificationTargets`)");
        expect(targetResolverSource).toContain("where(`categories.${category}`, '==', true)");
        expect(targetResolverSource).toContain('if (uid === actorUid) return null;');
        expect(targetResolverSource).toContain('users/${uid}/notificationPreferences/${teamId}');
        expect(targetResolverSource).toContain('users/${uid}/notificationDevices');
        expect(targetResolverSource).toContain('const missingUserIds = userIds.filter');
        expect(targetResolverSource).toContain('getLegacyTargetsForCategory(teamId, category, missingUserIds, actorUid)');
    });
});
