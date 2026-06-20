import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function extractChunk(startMarker, endMarker) {
    const start = functionsSource.indexOf(startMarker);
    const end = functionsSource.indexOf(endMarker, start);
    if (start === -1 || end === -1) {
        throw new Error(`Unable to extract source chunk for ${startMarker}.`);
    }
    return functionsSource.slice(start, end);
}

function getAwardHelpers() {
    return new Function(
        'firestore',
        'admin',
        `${extractChunk('function getCertificateNotificationPlayerKey(', 'async function practicePacketAssignedNotification')}
        return {
            getCertificateNotificationPlayerKey,
            resolvePublishedCertificateParentUserIds,
            claimPublishedCertificateAwardNotification,
            markPublishedCertificateAwardNotificationProcessed,
            buildAwardNotificationDestination
        };`
    );
}

function getTargetsForCategoryFactory() {
    return new Function(
        'NOTIFICATION_CATEGORIES',
        'firestore',
        'getCandidateUsersForTeam',
        'canReceiveCategoryNotification',
        'teamNotificationRecipientIndexIsEmpty',
        'backfillNotificationRecipientsForTeam',
        'getLegacyTargetsForCategory',
        'functions',
        `${extractChunk('async function getTargetsForCategory(', 'async function pruneInvalidTokens')}
        return getTargetsForCategory;`
    );
}

function buildFirestoreForParentLookup({ byPlayerKey = [], byTeamId = [] } = {}) {
    return {
        collection: vi.fn((path) => {
            expect(path).toBe('users');
            return {
                where: vi.fn((field, operator, value) => {
                    expect(operator).toBe('array-contains');
                    if (field === 'parentPlayerKeys') {
                        return {
                            get: vi.fn(async () => ({
                                docs: byPlayerKey
                                    .filter((entry) => entry.parentPlayerKeys?.includes(value))
                                    .map((entry) => ({
                                        id: entry.id,
                                        data: () => entry
                                    }))
                            }))
                        };
                    }
                    if (field === 'parentTeamIds') {
                        return {
                            get: vi.fn(async () => ({
                                docs: byTeamId
                                    .filter((entry) => entry.parentTeamIds?.includes(value))
                                    .map((entry) => ({
                                        id: entry.id,
                                        data: () => entry
                                    }))
                            }))
                        };
                    }
                    throw new Error(`Unexpected where field: ${field}`);
                })
            };
        }),
        runTransaction: vi.fn(async (handler) => handler({
            get: vi.fn(async () => ({ exists: false, data: () => ({}) })),
            update: vi.fn()
        }))
    };
}

function buildTriggerHarness({
    categories = ['awards', 'schedule'],
    claimResult = true,
    parentUserIds = [],
    targets = []
} = {}) {
    const claimPublishedCertificateAwardNotification = vi.fn(async () => claimResult);
    const resolvePublishedCertificateParentUserIds = vi.fn(async () => parentUserIds);
    const getTargetsForCategory = vi.fn(async () => targets);
    const sendDirectTargetsNotification = vi.fn(async () => ({ successCount: 1, failureCount: 0 }));
    const markPublishedCertificateAwardNotificationProcessed = vi.fn(async () => null);
    const buildAwardNotificationDestination = vi.fn(({ teamId, certificateId }) => ({
        link: `https://allplays.ai/app/#/parent-tools/certificates?teamId=${teamId}&certificateId=${certificateId}`,
        appRoute: `/parent-tools/certificates?teamId=${teamId}&certificateId=${certificateId}`
    }));
    const functions = {
        firestore: {
            document: vi.fn(() => ({
                onWrite: vi.fn((handler) => handler)
            }))
        },
        logger: {
            error: vi.fn(),
            warn: vi.fn()
        }
    };
    const exportsObject = {};
    const trigger = new Function(
        'exports',
        'functions',
        'NOTIFICATION_CATEGORIES',
        'claimPublishedCertificateAwardNotification',
        'resolvePublishedCertificateParentUserIds',
        'getTargetsForCategory',
        'sendDirectTargetsNotification',
        'markPublishedCertificateAwardNotificationProcessed',
        'buildAwardNotificationDestination',
        `${extractChunk('exports.notifyPublishedCertificateAward = functions.firestore', 'exports.notifyFeeAssigned = functions.firestore')}
        return exports.notifyPublishedCertificateAward;`
    )(
        exportsObject,
        functions,
        categories,
        claimPublishedCertificateAwardNotification,
        resolvePublishedCertificateParentUserIds,
        getTargetsForCategory,
        sendDirectTargetsNotification,
        markPublishedCertificateAwardNotificationProcessed,
        buildAwardNotificationDestination
    );

    return {
        trigger,
        functions,
        claimPublishedCertificateAwardNotification,
        resolvePublishedCertificateParentUserIds,
        getTargetsForCategory,
        sendDirectTargetsNotification,
        markPublishedCertificateAwardNotificationProcessed,
        buildAwardNotificationDestination
    };
}

describe('published certificate award helpers', () => {
    it('builds a stable player key and resolves parent ids from direct keys plus parentOf fallback', async () => {
        const firestore = buildFirestoreForParentLookup({
            byPlayerKey: [
                { id: 'parent-1', parentPlayerKeys: ['team-1::player-1'] }
            ],
            byTeamId: [
                { id: 'parent-2', parentTeamIds: ['team-1'], parentOf: [{ teamId: 'team-1', playerId: 'player-1' }] },
                { id: 'parent-3', parentTeamIds: ['team-1'], parentOf: [{ teamId: 'team-1', playerId: 'player-9' }] }
            ]
        });
        const admin = { firestore: { FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') } } };
        const helpers = getAwardHelpers()(firestore, admin);

        expect(helpers.getCertificateNotificationPlayerKey({ playerId: 'player-1' }, 'team-1')).toBe('team-1::player-1');
        await expect(helpers.resolvePublishedCertificateParentUserIds('team-1', { playerId: 'player-1' })).resolves.toEqual(['parent-1', 'parent-2']);
        expect(helpers.buildAwardNotificationDestination({ teamId: 'team-1', certificateId: 'cert-1' })).toEqual({
            link: 'https://allplays.ai/app/#/parent-tools/certificates?teamId=team-1&certificateId=cert-1',
            appRoute: '/parent-tools/certificates?teamId=team-1&certificateId=cert-1'
        });
    });

    it('claims the first published notification send with a retry-safe transaction guard and marks it processed after send', async () => {
        const certificateRef = {
            path: 'teams/team-1/certificates/cert-1',
            update: vi.fn(async () => null)
        };
        const firestore = {
            collection: vi.fn(),
            runTransaction: vi.fn(async (handler) => {
                const transaction = {
                    get: vi.fn(async () => ({ exists: true, data: () => ({ status: 'published' }) })),
                    update: vi.fn()
                };
                const result = await handler(transaction);
                expect(transaction.update).toHaveBeenCalledWith(certificateRef, {
                    awardNotificationProcessingEventId: 'event-1',
                    awardNotificationProcessingStartedAt: 'SERVER_TIMESTAMP'
                });
                return result;
            })
        };
        const admin = { firestore: { FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'), delete: vi.fn(() => 'DELETE_FIELD') } } };
        const helpers = getAwardHelpers()(firestore, admin);

        await expect(helpers.claimPublishedCertificateAwardNotification(certificateRef, 'event-1')).resolves.toBe(true);
        await expect(helpers.markPublishedCertificateAwardNotificationProcessed(certificateRef, 'event-1')).resolves.toBeNull();
        expect(certificateRef.update).toHaveBeenCalledWith({
            awardNotificationProcessedAt: 'SERVER_TIMESTAMP',
            awardNotificationProcessingEventId: 'DELETE_FIELD',
            awardNotificationProcessingStartedAt: 'DELETE_FIELD',
            awardNotificationProcessedEventId: 'event-1'
        });
    });

    it('keeps the same publish event claimable across retries until processing completes', async () => {
        const firestore = {
            collection: vi.fn(),
            runTransaction: vi.fn(async (handler) => handler({
                get: vi.fn(async () => ({
                    exists: true,
                    data: () => ({
                        status: 'published',
                        awardNotificationProcessingEventId: 'event-1'
                    })
                })),
                update: vi.fn()
            }))
        };
        const admin = { firestore: { FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') } } };
        const helpers = getAwardHelpers()(firestore, admin);

        await expect(helpers.claimPublishedCertificateAwardNotification({ path: 'teams/team-1/certificates/cert-1' }, 'event-1')).resolves.toBe(true);
    });
});


describe('getTargetsForCategory', () => {
    it('includes extra parent users when their eligibility comes only from parentPlayerKeys', async () => {
        const getTargetsForCategory = getTargetsForCategoryFactory()(
            ['awards'],
            {
                collection: vi.fn(() => ({
                    where: vi.fn(() => ({
                        get: vi.fn(async () => ({
                            empty: false,
                            docs: [{
                                data: () => ({
                                    uid: 'parent-1',
                                    deviceId: 'device-1',
                                    token: 'token-1'
                                })
                            }]
                        }))
                    }))
                }))
            },
            vi.fn(async () => []),
            vi.fn((category, user) => category === 'awards' && user.roles.includes('parent')),
            vi.fn(async () => false),
            vi.fn(async () => 0),
            vi.fn(async () => []),
            { logger: { warn: vi.fn() } }
        );

        await expect(getTargetsForCategory('team-1', 'awards', null, {}, [{ uid: 'parent-1', roles: ['parent'] }])).resolves.toEqual([
            {
                uid: 'parent-1',
                deviceId: 'device-1',
                token: 'token-1',
                teamId: 'team-1',
                platform: '',
                userAgent: ''
            }
        ]);
    });
});

describe('notifyPublishedCertificateAward trigger', () => {
    it('sends one awards push only to linked parent targets on first publish', async () => {
        const harness = buildTriggerHarness({
            parentUserIds: ['parent-1', 'parent-2'],
            targets: [
                { uid: 'parent-1', token: 'token-1', deviceId: 'device-1', teamId: 'team-1' },
                { uid: 'other-parent', token: 'token-2', deviceId: 'device-2', teamId: 'team-1' }
            ]
        });

        const liveData = { status: 'published' };
        await harness.trigger({
            before: { exists: true, data: () => ({ status: 'draft' }) },
            after: {
                exists: true,
                ref: { liveData },
                data: () => ({
                    status: 'published',
                    playerId: 'player-1',
                    recipientName: 'Avery Cruz',
                    awardTitle: 'Hustle Award'
                })
            }
        }, {
            eventId: 'event-1',
            params: { teamId: 'team-1', certificateId: 'cert-1' }
        });

        expect(harness.claimPublishedCertificateAwardNotification).toHaveBeenCalledWith({ liveData }, 'event-1');
        expect(harness.resolvePublishedCertificateParentUserIds).toHaveBeenCalledWith('team-1', expect.objectContaining({ playerId: 'player-1' }));
        expect(harness.getTargetsForCategory).toHaveBeenCalledWith('team-1', 'awards', null, {}, [
            { uid: 'parent-1', roles: ['parent'] },
            { uid: 'parent-2', roles: ['parent'] }
        ]);
        expect(harness.sendDirectTargetsNotification).toHaveBeenCalledWith(expect.objectContaining({
            category: 'awards',
            teamId: 'team-1',
            eventId: 'cert-1',
            title: 'Award published for Avery Cruz',
            body: 'Hustle Award is ready to view in ParentTools.',
            linkOverride: 'https://allplays.ai/app/#/parent-tools/certificates?teamId=team-1&certificateId=cert-1',
            appRouteOverride: '/parent-tools/certificates?teamId=team-1&certificateId=cert-1',
            targets: [
                { uid: 'parent-1', token: 'token-1', deviceId: 'device-1', teamId: 'team-1' }
            ]
        }));
        expect(harness.markPublishedCertificateAwardNotificationProcessed).toHaveBeenCalledWith({ liveData }, 'event-1');
    });

    it('skips edits to already published certificates', async () => {
        const harness = buildTriggerHarness({
            parentUserIds: ['parent-1'],
            targets: [{ uid: 'parent-1', token: 'token-1', deviceId: 'device-1', teamId: 'team-1' }]
        });

        await harness.trigger({
            before: { exists: true, data: () => ({ status: 'published' }) },
            after: {
                exists: true,
                ref: { liveData: { status: 'published' } },
                data: () => ({ status: 'published', playerId: 'player-1', awardTitle: 'Hustle Award' })
            }
        }, {
            eventId: 'event-1',
            params: { teamId: 'team-1', certificateId: 'cert-1' }
        });

        expect(harness.claimPublishedCertificateAwardNotification).not.toHaveBeenCalled();
        expect(harness.sendDirectTargetsNotification).not.toHaveBeenCalled();
    });

    it('skips re-publish attempts after the transaction guard has already claimed the send', async () => {
        const harness = buildTriggerHarness({
            claimResult: false,
            parentUserIds: ['parent-1'],
            targets: [{ uid: 'parent-1', token: 'token-1', deviceId: 'device-1', teamId: 'team-1' }]
        });

        await harness.trigger({
            before: { exists: true, data: () => ({ status: 'draft' }) },
            after: {
                exists: true,
                ref: { liveData: { status: 'published', awardNotificationProcessedAt: 'already-set' } },
                data: () => ({ status: 'published', playerId: 'player-1', awardTitle: 'Hustle Award' })
            }
        }, {
            eventId: 'event-1',
            params: { teamId: 'team-1', certificateId: 'cert-1' }
        });

        expect(harness.claimPublishedCertificateAwardNotification).toHaveBeenCalled();
        expect(harness.sendDirectTargetsNotification).not.toHaveBeenCalled();
    });
});
