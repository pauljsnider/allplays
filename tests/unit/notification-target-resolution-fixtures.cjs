const LEGACY_CATEGORY_RESOLUTION_FIXTURES = Object.freeze([
    {
        name: 'schedule legacy resolution keeps only enabled recipients and valid devices',
        request: {
            teamId: 'team-fixture-schedule',
            category: 'schedule'
        },
        options: {
            teamId: 'team-fixture-schedule',
            teamDoc: {
                ownerId: 'coach-1',
                adminEmails: []
            },
            parentUserIds: ['parent-1', 'parent-2', 'parent-3'],
            preferenceDocs: {
                'users/coach-1/notificationPreferences/team-fixture-schedule': {
                    schedule: true,
                    media: true
                },
                'users/parent-1/notificationPreferences/team-fixture-schedule': {
                    schedule: true,
                    media: false
                },
                'users/parent-2/notificationPreferences/team-fixture-schedule': {
                    schedule: false,
                    media: true
                },
                'users/parent-3/notificationPreferences/team-fixture-schedule': {
                    schedule: true,
                    media: true
                }
            },
            deviceDocs: {
                'coach-1': [
                    { id: 'coach-phone', token: 'coach-phone-token' },
                    { id: 'coach-watch', token: 'coach-watch-token' }
                ],
                'parent-1': [
                    { id: 'parent-1-phone', token: 'parent-1-phone-token' }
                ],
                'parent-2': [
                    { id: 'parent-2-phone', token: 'parent-2-phone-token' }
                ],
                'parent-3': [
                    { id: 'parent-3-empty', token: '' },
                    { id: 'parent-3-tablet', token: 'parent-3-tablet-token' }
                ]
            }
        },
        expectedTargets: [
            { uid: 'coach-1', deviceId: 'coach-phone', token: 'coach-phone-token' },
            { uid: 'coach-1', deviceId: 'coach-watch', token: 'coach-watch-token' },
            { uid: 'parent-1', deviceId: 'parent-1-phone', token: 'parent-1-phone-token' },
            { uid: 'parent-3', deviceId: 'parent-3-tablet', token: 'parent-3-tablet-token' }
        ],
        expectedCounts: {
            targetQueries: 1,
            parentQueries: 1,
            preferenceGets: 4,
            deviceGets: 4
        },
        expectedIndexedCounts: {
            preferenceGets: 1,
            deviceGets: 1
        }
    },
    {
        name: 'private media legacy resolution excludes parent devices from sends',
        request: {
            teamId: 'team-fixture-private-media',
            category: 'media',
            audienceContext: {
                albumVisibility: 'private'
            }
        },
        options: {
            teamId: 'team-fixture-private-media',
            teamDoc: {
                ownerId: 'coach-2',
                adminEmails: []
            },
            parentUserIds: ['parent-4', 'parent-5'],
            preferenceDocs: {
                'users/coach-2/notificationPreferences/team-fixture-private-media': {
                    media: true
                },
                'users/parent-4/notificationPreferences/team-fixture-private-media': {
                    media: true
                },
                'users/parent-5/notificationPreferences/team-fixture-private-media': {
                    media: true
                }
            },
            deviceDocs: {
                'coach-2': [
                    { id: 'coach-2-phone', token: 'coach-2-phone-token' },
                    { id: 'coach-2-tablet', token: 'coach-2-tablet-token' }
                ],
                'parent-4': [
                    { id: 'parent-4-phone', token: 'parent-4-phone-token' }
                ],
                'parent-5': [
                    { id: 'parent-5-phone', token: 'parent-5-phone-token' }
                ]
            }
        },
        expectedTargets: [
            { uid: 'coach-2', deviceId: 'coach-2-phone', token: 'coach-2-phone-token' },
            { uid: 'coach-2', deviceId: 'coach-2-tablet', token: 'coach-2-tablet-token' }
        ],
        expectedCounts: {
            targetQueries: 1,
            parentQueries: 1,
            preferenceGets: 1,
            deviceGets: 1
        },
        expectedIndexedCounts: {
            preferenceGets: 0,
            deviceGets: 0
        }
    }
]);

function normalizeResolvedTargets(targets = []) {
    return targets
        .map((target) => ({
            uid: String(target?.uid || ''),
            deviceId: String(target?.deviceId || ''),
            token: String(target?.token || '')
        }))
        .sort((left, right) => {
            const leftKey = `${left.uid}::${left.deviceId}::${left.token}`;
            const rightKey = `${right.uid}::${right.deviceId}::${right.token}`;
            return leftKey.localeCompare(rightKey);
        });
}

function buildIndexedTargetsFromExpected(category, expectedTargets = []) {
    return expectedTargets.map((target) => ({
        uid: target.uid,
        deviceId: target.deviceId,
        token: target.token,
        categories: {
            [category]: true
        }
    }));
}

module.exports = {
    LEGACY_CATEGORY_RESOLUTION_FIXTURES,
    normalizeResolvedTargets,
    buildIndexedTargetsFromExpected
};
