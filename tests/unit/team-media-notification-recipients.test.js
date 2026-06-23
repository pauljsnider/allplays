import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const firestoreIndexes = readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8');

function getSourceSlice(startMarker, endMarker) {
    const start = functionsSource.indexOf(startMarker);
    const end = functionsSource.indexOf(endMarker, start);
    if (start === -1 || end === -1) {
        throw new Error(`Unable to extract source between ${startMarker} and ${endMarker}`);
    }
    return functionsSource.slice(start, end);
}

function createFirestoreMock({ indexedTargets = [], preferences = {}, devices = {} } = {}) {
    return {
        collection: vi.fn((path) => {
            if (path.startsWith('teams/') && path.endsWith('/notificationRecipients')) {
                return {
                    where: vi.fn((field) => ({
                        get: vi.fn(async () => ({
                            docs: indexedTargets
                                .filter((target) => {
                                    const categories = target.categories || { media: true };
                                    return categories[String(field).replace(/^categories\./, '')] === true;
                                })
                                .map((target) => ({
                                    id: `${target.uid}__${target.deviceId}`,
                                    data: () => ({
                                        ...target,
                                        categories: target.categories || { media: true }
                                    })
                                }))
                        }))
                    }))
                };
            }

            if (path.startsWith('users/') && path.endsWith('/notificationDevices')) {
                const uid = path.split('/')[1];
                return {
                    get: vi.fn(async () => ({
                        docs: (devices[uid] || []).map((device) => ({
                            id: device.deviceId,
                            data: () => ({ token: device.token })
                        }))
                    }))
                };
            }

            throw new Error(`Unexpected collection path: ${path}`);
        }),
        doc: vi.fn((path) => ({
            get: vi.fn(async () => {
                const match = path.match(/^users\/([^/]+)\/notificationPreferences\/([^/]+)$/);
                if (!match) {
                    throw new Error(`Unexpected doc path: ${path}`);
                }
                const [, uid, teamId] = match;
                const data = preferences[uid]?.[teamId];
                return {
                    exists: Boolean(data),
                    data: () => data
                };
            })
        }))
    };
}

function normalizeTargets(targets = []) {
    return targets.map((target) => ({
        uid: target.uid,
        deviceId: target.deviceId,
        token: target.token,
        teamId: target.teamId
    }));
}

function createHarness({ candidateUsers = [], indexedTargets = [], preferences = {}, devices = {} } = {}) {
    const helperSource = getSourceSlice(
        'function normalizeNotificationAlbumVisibility',
        '\nasync function pruneInvalidTokens'
    );
    const rolesByUid = new Map(candidateUsers.map((user) => [user.uid, user.roles || []]));
    const indexedTargetsWithRoles = indexedTargets.map((target) => ({
        ...target,
        roles: target.roles || rolesByUid.get(target.uid) || []
    }));
    const firestore = createFirestoreMock({ indexedTargets: indexedTargetsWithRoles, preferences, devices });
    const getCandidateUsersForTeam = vi.fn(async () => candidateUsers);
    const notificationAudienceAllowsRoles = vi.fn((category, roles = []) => {
        if (category !== 'media') return false;
        return Array.isArray(roles) && (roles.includes('parent') || roles.includes('staff'));
    });

    const factory = new Function(
        'firestore',
        'NOTIFICATION_CATEGORIES',
        'notificationAudienceAllowsRoles',
        'DEFAULT_NOTIFICATION_PREFERENCES',
        'normalizeNotificationPreferences',
        'getCandidateUsersForTeam',
        `${helperSource}\nreturn { getTargetsForCategory, getLegacyTargetsForCategory, canReceiveCategoryNotification };`
    );

    const helpers = factory(
        firestore,
        ['media'],
        notificationAudienceAllowsRoles,
        { media: false },
        (prefs) => ({ media: prefs?.media === true }),
        getCandidateUsersForTeam
    );

    return {
        ...helpers,
        firestore,
        getCandidateUsersForTeam,
        notificationAudienceAllowsRoles
    };
}

describe('team media notification recipients', () => {
    it('registers batched team media push notification queue and dispatcher functions', () => {
        expect(functionsSource).toContain('exports.queueTeamMediaNotificationBatch = functions.firestore');
        expect(functionsSource).toContain(".document('teams/{teamId}/mediaItems/{itemId}')");
        expect(functionsSource).toContain('exports.dispatchDueTeamMediaNotificationBatches = functions.pubsub');
        expect(functionsSource).toContain("firestore.collection('teamMediaNotificationBatches')");
        expect(functionsSource).toContain("category: 'media'");
        expect(functionsSource).toContain('dedupKey: `team-media:${batch.id}`');
        expect(functionsSource).toContain('const audienceContext = buildTeamMediaNotificationAudienceContext({');
        expect(functionsSource).toMatch(/sendCategoryNotification\(\{[\s\S]*dedupKey: `team-media:\$\{batch\.id\}`,[\s\S]*audienceContext[\s\S]*\}\)/);
        expect(functionsSource).toContain("['sent', 'sending', 'skipped'].includes(currentStatus)");
        expect(firestoreIndexes).toContain('"collectionGroup": "teamMediaNotificationBatches"');
        expect(firestoreIndexes).toContain('"fieldPath": "dueAt"');
    });

    it.each([
        { albumVisibility: 'private' },
        { albumVisibility: 'staff-only' },
        { albumVisibility: 'staff_only' },
        { albumVisibility: 'staff' },
        { albumVisibility: 'team', staffOnly: true }
    ])('filters restricted-album media recipients down to staff-only targets for %j', async (audienceContext) => {
        const harness = createHarness({
            candidateUsers: [
                { uid: 'parent-1', roles: ['parent'] },
                { uid: 'staff-1', roles: ['staff'] }
            ],
            indexedTargets: [
                { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token' },
                { uid: 'staff-1', deviceId: 'staff-device', token: 'staff-token' }
            ]
        });

        const targets = await harness.getTargetsForCategory('team-1', 'media', null, audienceContext);

        expect(normalizeTargets(targets)).toEqual([
            {
                uid: 'staff-1',
                deviceId: 'staff-device',
                token: 'staff-token',
                teamId: 'team-1'
            }
        ]);
    });

    it('keeps otherwise eligible parent and staff recipients for team-visible albums', async () => {
        const harness = createHarness({
            candidateUsers: [
                { uid: 'parent-1', roles: ['parent'] },
                { uid: 'staff-1', roles: ['staff'] }
            ],
            preferences: {
                'parent-1': { 'team-1': { media: true } },
                'staff-1': { 'team-1': { media: true } }
            },
            devices: {
                'parent-1': [{ deviceId: 'parent-device', token: 'parent-token' }],
                'staff-1': [{ deviceId: 'staff-device', token: 'staff-token' }]
            }
        });

        const targets = await harness.getTargetsForCategory('team-1', 'media', null, { albumVisibility: 'team' });

        expect(normalizeTargets(targets)).toEqual([
            {
                uid: 'parent-1',
                deviceId: 'parent-device',
                token: 'parent-token',
                teamId: 'team-1'
            },
            {
                uid: 'staff-1',
                deviceId: 'staff-device',
                token: 'staff-token',
                teamId: 'team-1'
            }
        ]);
    });

    it('keeps indexed parent and staff targets for standard visible albums', async () => {
        const harness = createHarness({
            candidateUsers: [
                { uid: 'parent-1', roles: ['parent'] },
                { uid: 'parent-disabled', roles: ['parent'] },
                { uid: 'staff-1', roles: ['staff'] }
            ],
            indexedTargets: [
                { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token', categories: { media: true } },
                { uid: 'parent-disabled', deviceId: 'disabled-device', token: 'disabled-token', categories: { media: false } },
                { uid: 'staff-1', deviceId: 'staff-device', token: 'staff-token', categories: { media: true } }
            ]
        });

        const targets = await harness.getTargetsForCategory('team-1', 'media', null, { albumVisibility: 'team' });

        expect(normalizeTargets(targets)).toEqual([
            {
                uid: 'parent-1',
                deviceId: 'parent-device',
                token: 'parent-token',
                teamId: 'team-1'
            },
            {
                uid: 'staff-1',
                deviceId: 'staff-device',
                token: 'staff-token',
                teamId: 'team-1'
            }
        ]);
    });

    it('filters indexed team-visible media recipients by explicit allowed user ids', async () => {
        const harness = createHarness({
            candidateUsers: [
                { uid: 'parent-1', roles: ['parent'] },
                { uid: 'parent-2', roles: ['parent'] },
                { uid: 'staff-1', roles: ['staff'] }
            ],
            indexedTargets: [
                { uid: 'parent-1', deviceId: 'parent-1-device', token: 'parent-1-token' },
                { uid: 'parent-2', deviceId: 'parent-2-device', token: 'parent-2-token' },
                { uid: 'staff-1', deviceId: 'staff-device', token: 'staff-token' }
            ]
        });

        const targets = await harness.getTargetsForCategory('team-1', 'media', null, {
            albumVisibility: 'team',
            allowedUserIds: ['parent-2', 'staff-1']
        });

        expect(normalizeTargets(targets)).toEqual([
            {
                uid: 'parent-2',
                deviceId: 'parent-2-device',
                token: 'parent-2-token',
                teamId: 'team-1'
            },
            {
                uid: 'staff-1',
                deviceId: 'staff-device',
                token: 'staff-token',
                teamId: 'team-1'
            }
        ]);
    });

    it('distinguishes visible and restricted album eligibility with the same candidate users', async () => {
        const createSharedHarness = () => createHarness({
            candidateUsers: [
                { uid: 'parent-1', roles: ['parent'] },
                { uid: 'staff-1', roles: ['staff'] }
            ],
            indexedTargets: [
                { uid: 'parent-1', deviceId: 'parent-device', token: 'parent-token' },
                { uid: 'staff-1', deviceId: 'staff-device', token: 'staff-token' }
            ]
        });

        const visibleTargets = await createSharedHarness().getTargetsForCategory('team-1', 'media', null, { albumVisibility: 'team' });
        const restrictedTargets = await createSharedHarness().getTargetsForCategory('team-1', 'media', null, { albumVisibility: 'private' });

        expect(normalizeTargets(visibleTargets).map((target) => target.uid)).toEqual(['parent-1', 'staff-1']);
        expect(normalizeTargets(restrictedTargets).map((target) => target.uid)).toEqual(['staff-1']);
    });

    it('filters fallback team-visible media recipients by explicit audience roles', async () => {
        const harness = createHarness({
            candidateUsers: [
                { uid: 'parent-1', roles: ['parent'] },
                { uid: 'staff-1', roles: ['staff'] }
            ],
            preferences: {
                'parent-1': { 'team-1': { media: true } },
                'staff-1': { 'team-1': { media: true } }
            },
            devices: {
                'parent-1': [{ deviceId: 'parent-device', token: 'parent-token' }],
                'staff-1': [{ deviceId: 'staff-device', token: 'staff-token' }]
            }
        });

        const targets = await harness.getTargetsForCategory('team-1', 'media', null, {
            albumVisibility: 'team',
            allowedRoles: ['parent']
        });

        expect(normalizeTargets(targets)).toEqual([
            {
                uid: 'parent-1',
                deviceId: 'parent-device',
                token: 'parent-token',
                teamId: 'team-1'
            }
        ]);
    });

    it('skips fallback parent targets for private albums even when media notifications are enabled', async () => {
        const harness = createHarness({
            candidateUsers: [
                { uid: 'parent-1', roles: ['parent'] },
                { uid: 'staff-1', roles: ['staff'] }
            ],
            preferences: {
                'parent-1': { 'team-1': { media: true } },
                'staff-1': { 'team-1': { media: true } }
            },
            devices: {
                'parent-1': [{ deviceId: 'parent-device', token: 'parent-token' }],
                'staff-1': [{ deviceId: 'staff-device', token: 'staff-token' }]
            }
        });

        const targets = await harness.getTargetsForCategory('team-1', 'media', null, { albumVisibility: 'private' });

        expect(normalizeTargets(targets)).toEqual([
            {
                uid: 'staff-1',
                deviceId: 'staff-device',
                token: 'staff-token',
                teamId: 'team-1'
            }
        ]);
    });

    it('keeps private album fanout staff-only even when explicit audience lists include parents', async () => {
        const harness = createHarness({
            candidateUsers: [
                { uid: 'parent-1', roles: ['parent'] },
                { uid: 'parent-2', roles: ['parent'] },
                { uid: 'staff-1', roles: ['staff'] }
            ],
            indexedTargets: [
                { uid: 'parent-1', deviceId: 'parent-1-device', token: 'parent-1-token' },
                { uid: 'parent-2', deviceId: 'parent-2-device', token: 'parent-2-token' },
                { uid: 'staff-1', deviceId: 'staff-device', token: 'staff-token' }
            ]
        });

        const targets = await harness.getTargetsForCategory('team-1', 'media', null, {
            albumVisibility: 'private',
            allowedUserIds: ['parent-2'],
            allowedRoles: ['staff']
        });

        expect(normalizeTargets(targets)).toEqual([
            {
                uid: 'staff-1',
                deviceId: 'staff-device',
                token: 'staff-token',
                teamId: 'team-1'
            }
        ]);
    });
});
