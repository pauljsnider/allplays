import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function getSourceSlice(startMarker, endMarker) {
    const start = functionsSource.indexOf(startMarker);
    const end = functionsSource.indexOf(endMarker, start);
    if (start === -1 || end === -1) {
        throw new Error(`Unable to extract source between ${startMarker} and ${endMarker}`);
    }
    return functionsSource.slice(start, end);
}

function buildFirestoreTimestamp(ms) {
    return {
        toMillis: () => ms
    };
}

function buildDedupDocPath(teamId, category, gameId = null, dedupKey = null) {
    const crypto = require('node:crypto');
    const normalizedGameId = String(gameId || '').trim();
    const normalizedDedupKey = String(dedupKey || '').trim();
    const dedupIdentity = normalizedGameId && normalizedDedupKey
        ? `${normalizedGameId}::${normalizedDedupKey}`
        : (normalizedDedupKey || normalizedGameId);
    const key = [teamId, category, dedupIdentity].join('::');
    const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
    return `teams/${teamId}/notificationSendLog/${hash}`;
}

function createDedupHarness({ nowMs, docs = {} } = {}) {
    const store = new Map(
        Object.entries(docs).map(([path, data]) => [path, { ...data }])
    );
    const mockFirestore = {
        doc: vi.fn((path) => ({ path })),
        runTransaction: vi.fn(async (fn) => {
            const txn = {
                get: vi.fn(async (docRef) => {
                    const data = store.get(docRef.path);
                    return {
                        exists: Boolean(data),
                        data: () => data
                    };
                }),
                set: vi.fn((docRef, data) => {
                    store.set(docRef.path, {
                        ...data,
                        sentAt: data.sentAt === 'SERVER_TIMESTAMP'
                            ? buildFirestoreTimestamp(nowMs)
                            : data.sentAt
                    });
                })
            };
            return fn(txn);
        })
    };
    const mockAdmin = {
        firestore: {
            FieldValue: {
                serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP')
            }
        }
    };

    const helperSource = getSourceSlice(
        'const NOTIFICATION_DEDUP_WINDOW_MS',
        '\nasync function sendCategoryNotification'
    );

    const factory = new Function(
        'firestore', 'admin', 'crypto',
        `${helperSource}\nreturn checkAndSetNotificationDedup;`
    );

    const rawFn = factory(mockFirestore, mockAdmin, require('node:crypto'));
    const fn = async (...args) => {
        const originalDateNow = Date.now;
        Date.now = () => nowMs;
        try {
            return await rawFn(...args);
        } finally {
            Date.now = originalDateNow;
        }
    };
    return { fn, mockFirestore, mockAdmin, store };
}

function buildSendCategoryNotificationHarness({
    canSend = true,
    targets = [{ uid: 'user-1', token: 'token-1' }],
    categories = ['schedule', 'liveScore', 'mentions', 'liveChat'],
    deliveryOptions = {},
    sendEachForMulticastImpl = async () => ({
        responses: [{ success: true }],
        successCount: targets.length,
        failureCount: 0
    })
} = {}) {
    const sendSource = getSourceSlice(
        'async function sendCategoryNotification({',
        '\nasync function sendDirectTargetsNotification'
    );
    const sendEachForMulticast = vi.fn(sendEachForMulticastImpl);
    const admin = {
        messaging: () => ({
            sendEachForMulticast
        })
    };
    const checkAndSetNotificationDedup = vi.fn(async () => canSend);
    const getTargetsForCategory = vi.fn(async () => targets);
    const buildNotificationLink = vi.fn(({ category, teamId, gameId }) => `https://allplays.ai/${category}/${teamId}/${gameId || ''}`);
    const buildNotificationAppRoute = vi.fn(({ category, teamId, gameId, eventId }) => `/${category}/${teamId}/${gameId || eventId || ''}`);
    const buildNotificationDeliveryOptions = vi.fn(() => deliveryOptions);
    const pruneInvalidTokens = vi.fn(async () => {});
    const writeNotificationInboxRecords = vi.fn(async () => ({
        writeCount: targets.length,
        cleanupCount: 0,
        failureCount: 0
    }));
    const writeNotificationAuditRecord = vi.fn(async () => {});
    const getUniqueNotificationInboxTargets = (notificationTargets = []) => {
        const targetsByUid = new Map();
        notificationTargets.forEach((target) => {
            const uid = String(target?.uid || '').trim();
            if (uid && !targetsByUid.has(uid)) targetsByUid.set(uid, { ...target, uid });
        });
        return Array.from(targetsByUid.values());
    };
    const functions = {
        logger: {
            info: vi.fn(),
            warn: vi.fn()
        }
    };

    const factory = new Function(
        'NOTIFICATION_CATEGORIES',
        'checkAndSetNotificationDedup',
        'getTargetsForCategory',
        'buildNotificationLink',
        'buildNotificationAppRoute',
        'buildNotificationDeliveryOptions',
        'admin',
        'WEB_PUSH_NOTIFICATION_ASSETS',
        'pruneInvalidTokens',
        'writeNotificationInboxRecords',
        'writeNotificationAuditRecord',
        'getUniqueNotificationInboxTargets',
        'functions',
        `${sendSource}\nreturn sendCategoryNotification;`
    );

    const fn = factory(
        categories,
        checkAndSetNotificationDedup,
        getTargetsForCategory,
        buildNotificationLink,
        buildNotificationAppRoute,
        buildNotificationDeliveryOptions,
        admin,
        { icon: '/img/logo_small.png', badge: '/img/logo_small.png' },
        pruneInvalidTokens,
        writeNotificationInboxRecords,
        writeNotificationAuditRecord,
        getUniqueNotificationInboxTargets,
        functions
    );

    return {
        fn,
        sendEachForMulticast,
        checkAndSetNotificationDedup,
        getTargetsForCategory,
        buildNotificationLink,
        buildNotificationAppRoute,
        buildNotificationDeliveryOptions,
        pruneInvalidTokens,
        writeNotificationInboxRecords,
        writeNotificationAuditRecord,
        functions
    };
}

describe('notification send dedup guard — checkAndSetNotificationDedup', () => {
    it('writes the Firestore dedup record when no prior send exists', async () => {
        const now = Date.now();
        const { fn, store, mockFirestore } = createDedupHarness({ nowMs: now });

        const result = await fn('team-1', 'schedule', 'game-1');

        expect(result).toBe(true);
        expect(mockFirestore.doc).toHaveBeenCalledWith(expect.stringMatching(/^teams\/team-1\/notificationSendLog\//));
        const [[docPath, savedDoc]] = [...store.entries()];
        expect(docPath).toMatch(/^teams\/team-1\/notificationSendLog\//);
        expect(savedDoc.teamId).toBe('team-1');
        expect(savedDoc.category).toBe('schedule');
        expect(savedDoc.gameId).toBe('game-1');
        expect(savedDoc.sentAt.toMillis()).toBe(now);
    });

    it('returns false when the Firestore dedup log contains a send inside the 5-minute window', async () => {
        const now = Date.now();
        const existingPath = buildDedupDocPath('team-1', 'schedule', 'game-1');
        const { fn } = createDedupHarness({
            nowMs: now,
            docs: {
                [existingPath]: {
                    teamId: 'team-1',
                    category: 'schedule',
                    gameId: 'game-1',
                    sentAt: buildFirestoreTimestamp(now - 4 * 60 * 1000)
                }
            }
        });

        const result = await fn('team-1', 'schedule', 'game-1');

        expect(result).toBe(false);
    });

    it('returns true when the Firestore dedup log entry is older than the 5-minute window', async () => {
        const now = Date.now();
        const dedupPath = buildDedupDocPath('team-1', 'schedule', 'game-1');

        const { fn } = createDedupHarness({
            nowMs: now,
            docs: {
                [dedupPath]: {
                    teamId: 'team-1',
                    category: 'schedule',
                    gameId: 'game-1',
                    sentAt: buildFirestoreTimestamp(now - 6 * 60 * 1000)
                }
            }
        });

        const result = await fn('team-1', 'schedule', 'game-1');

        expect(result).toBe(true);
    });

    it('uses a different Firestore dedup document for different gameIds', async () => {
        const now = Date.now();
        const first = createDedupHarness({ nowMs: now });
        const second = createDedupHarness({ nowMs: now });

        await first.fn('team-1', 'schedule', 'game-A');
        await second.fn('team-1', 'schedule', 'game-B');

        expect(first.mockFirestore.doc.mock.calls[0][0]).not.toBe(second.mockFirestore.doc.mock.calls[0][0]);
    });

    it('uses a different Firestore dedup document for different notification categories', async () => {
        const now = Date.now();
        const first = createDedupHarness({ nowMs: now });
        const second = createDedupHarness({ nowMs: now });

        await first.fn('team-1', 'schedule', 'game-1');
        await second.fn('team-1', 'practice', 'game-1');

        expect(first.mockFirestore.doc.mock.calls[0][0]).not.toBe(second.mockFirestore.doc.mock.calls[0][0]);
        expect([...first.store.values()][0]).toMatchObject({ category: 'schedule', gameId: 'game-1' });
        expect([...second.store.values()][0]).toMatchObject({ category: 'practice', gameId: 'game-1' });
    });

    it('scopes custom dedup keys to the gameId so matching score transitions do not collide across games', async () => {
        const now = Date.now();
        const existingPath = buildDedupDocPath('team-1', 'liveScore', 'game-1', 'score:0:0->2:0');
        const { fn, mockFirestore } = createDedupHarness({
            nowMs: now,
            docs: {
                [existingPath]: {
                    teamId: 'team-1',
                    category: 'liveScore',
                    gameId: 'game-1',
                    dedupKey: 'score:0:0->2:0',
                    sentAt: buildFirestoreTimestamp(now - 60 * 1000)
                }
            }
        });

        const result = await fn('team-1', 'liveScore', 'game-2', 'score:0:0->2:0');

        expect(result).toBe(true);
        expect(mockFirestore.doc).toHaveBeenCalledWith(expect.stringMatching(/^teams\/team-1\/notificationSendLog\//));
        expect(mockFirestore.doc.mock.calls.at(-1)[0]).not.toBe(existingPath);
    });
});

describe('notification send dedup guard — sendCategoryNotification', () => {
    it('skips schedule sends when the dedup transaction reports a recent Firestore send', async () => {
        const harness = buildSendCategoryNotificationHarness({ canSend: false });

        const result = await harness.fn({
            teamId: 'team-1',
            category: 'schedule',
            gameId: 'game-1',
            title: 'Schedule update',
            body: 'Details changed.'
        });

        expect(result).toBeNull();
        expect(harness.checkAndSetNotificationDedup).toHaveBeenCalledWith('team-1', 'schedule', 'game-1', null);
        expect(harness.sendEachForMulticast).not.toHaveBeenCalled();
        expect(harness.functions.logger.info).toHaveBeenCalledWith(
            'Notification dedup: skipping duplicate send',
            { teamId: 'team-1', category: 'schedule', gameId: 'game-1', dedupKey: null }
        );
    });

    it('keeps an allowed deduped send scoped to the logical event while preserving all device tokens', async () => {
        const harness = buildSendCategoryNotificationHarness({
            canSend: true,
            targets: [
                { uid: 'parent-1', deviceId: 'ios-1', token: 'token-1' },
                { uid: 'parent-1', deviceId: 'web-1', token: 'token-2' }
            ]
        });

        const result = await harness.fn({
            teamId: 'team-1',
            category: 'schedule',
            gameId: 'game-1',
            dedupKey: 'schedule-import:batch-1',
            title: 'Schedule imported',
            body: 'Two new events were added.'
        });

        expect(harness.checkAndSetNotificationDedup).toHaveBeenCalledWith(
            'team-1',
            'schedule',
            'game-1',
            'schedule-import:batch-1'
        );
        expect(harness.sendEachForMulticast).toHaveBeenCalledWith(expect.objectContaining({
            tokens: ['token-1', 'token-2']
        }));
        expect(harness.writeNotificationInboxRecords).toHaveBeenCalledWith(expect.objectContaining({
            targets: [
                { uid: 'parent-1', deviceId: 'ios-1', token: 'token-1' }
            ]
        }));
        expect(result).toMatchObject({ successCount: 2, failureCount: 0 });
    });

    it('does not run the dedup guard for liveChat sends', async () => {
        const harness = buildSendCategoryNotificationHarness({ canSend: false });

        const result = await harness.fn({
            teamId: 'team-1',
            category: 'liveChat',
            title: 'Coach: Team Chat',
            body: 'New chat message.'
        });

        expect(harness.checkAndSetNotificationDedup).not.toHaveBeenCalled();
        expect(harness.sendEachForMulticast).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ successCount: 1, failureCount: 0 });
    });

    it('does not run the dedup guard for mentions sends', async () => {
        const harness = buildSendCategoryNotificationHarness({ canSend: false });

        await harness.fn({
            teamId: 'team-1',
            category: 'mentions',
            title: 'Coach mentioned you',
            body: 'Please check chat.'
        });

        expect(harness.checkAndSetNotificationDedup).not.toHaveBeenCalled();
        expect(harness.sendEachForMulticast).toHaveBeenCalledOnce();
    });

    it('guards delivery metadata usage so liveChat sends work without extra helpers', async () => {
        const harness = buildSendCategoryNotificationHarness({
            categories: ['liveChat', 'mentions']
        });

        await expect(harness.fn({
            teamId: 'team-1',
            gameId: 'game-1',
            category: 'liveChat',
            title: 'New message',
            body: 'Hello team'
        })).resolves.toEqual(expect.objectContaining({
            successCount: 1,
            failureCount: 0
        }));

        expect(harness.buildNotificationDeliveryOptions).toHaveBeenCalledWith({
            category: 'liveChat',
            teamId: 'team-1',
            gameId: 'game-1',
            eventId: 'game-1',
            timeSensitive: false
        });
    });

    it('guards delivery metadata usage so mentions sends work without extra helpers', async () => {
        const harness = buildSendCategoryNotificationHarness({
            categories: ['liveChat', 'mentions']
        });

        await expect(harness.fn({
            teamId: 'team-1',
            gameId: 'game-1',
            eventId: 'message-1',
            category: 'mentions',
            title: 'Mention',
            body: 'You were mentioned'
        })).resolves.toEqual(expect.objectContaining({
            successCount: 1,
            failureCount: 0
        }));

        expect(harness.buildNotificationDeliveryOptions).toHaveBeenCalledWith({
            category: 'mentions',
            teamId: 'team-1',
            gameId: 'game-1',
            eventId: 'message-1',
            timeSensitive: false
        });
    });

    it('still writes inbox records when push delivery throws for live score updates', async () => {
        const harness = buildSendCategoryNotificationHarness({
            categories: ['liveScore'],
            targets: [
                { uid: 'parent-1', token: 'token-1' },
                { uid: 'parent-2', token: 'token-2' }
            ],
            sendEachForMulticastImpl: async () => {
                throw new Error('messaging unavailable');
            }
        });

        const result = await harness.fn({
            teamId: 'team-1',
            category: 'liveScore',
            gameId: 'game-7',
            title: 'Live score update',
            body: 'Score is now 2-1'
        });

        expect(harness.sendEachForMulticast).toHaveBeenCalledOnce();
        expect(harness.writeNotificationInboxRecords).toHaveBeenCalledWith(expect.objectContaining({
            category: 'liveScore',
            teamId: 'team-1',
            gameId: 'game-7',
            targets: [
                { uid: 'parent-1', token: 'token-1' },
                { uid: 'parent-2', token: 'token-2' }
            ]
        }));
        expect(harness.writeNotificationAuditRecord).toHaveBeenCalledWith(expect.objectContaining({
            failureCount: 2,
            inboxResult: expect.objectContaining({ writeCount: 2 })
        }));
        expect(result).toMatchObject({
            successCount: 0,
            failureCount: 2,
            inboxWriteCount: 2
        });
    });

    it('firestore.rules denies all client access to notificationSendLog', () => {
        const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
        expect(rules).toContain('match /notificationSendLog/{docId}');
        const ruleStart = rules.indexOf('match /notificationSendLog/{docId}');
        const ruleSnippet = rules.slice(ruleStart, ruleStart + 200);
        expect(ruleSnippet).toContain('allow read, write: if false');
    });
});
