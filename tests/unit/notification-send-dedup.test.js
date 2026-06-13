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

function buildDedupDocPath(teamId, category, gameId = null) {
    const crypto = require('node:crypto');
    const key = [teamId, category, gameId || ''].join('::');
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
    targets = [{ uid: 'user-1', token: 'token-1' }]
} = {}) {
    const sendSource = getSourceSlice(
        'async function sendCategoryNotification({',
        '\nasync function sendDirectTargetsNotification'
    );
    const sendEachForMulticast = vi.fn(async () => ({
        responses: [{ success: true }],
        successCount: targets.length,
        failureCount: 0
    }));
    const admin = {
        messaging: () => ({
            sendEachForMulticast
        })
    };
    const checkAndSetNotificationDedup = vi.fn(async () => canSend);
    const getTargetsForCategory = vi.fn(async () => targets);
    const buildNotificationLink = vi.fn(({ category, teamId, gameId }) => `https://allplays.ai/${category}/${teamId}/${gameId || ''}`);
    const buildNotificationAppRoute = vi.fn(({ category, teamId, gameId, eventId }) => `/${category}/${teamId}/${gameId || eventId || ''}`);
    const pruneInvalidTokens = vi.fn(async () => {});
    const functions = {
        logger: {
            info: vi.fn()
        }
    };

    const factory = new Function(
        'NOTIFICATION_CATEGORIES',
        'checkAndSetNotificationDedup',
        'getTargetsForCategory',
        'buildNotificationLink',
        'buildNotificationAppRoute',
        'admin',
        'pruneInvalidTokens',
        'functions',
        `${sendSource}\nreturn sendCategoryNotification;`
    );

    const fn = factory(
        ['schedule', 'liveScore', 'mentions', 'liveChat'],
        checkAndSetNotificationDedup,
        getTargetsForCategory,
        buildNotificationLink,
        buildNotificationAppRoute,
        admin,
        pruneInvalidTokens,
        functions
    );

    return {
        fn,
        sendEachForMulticast,
        checkAndSetNotificationDedup,
        getTargetsForCategory,
        buildNotificationLink,
        buildNotificationAppRoute,
        pruneInvalidTokens,
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
        expect(harness.checkAndSetNotificationDedup).toHaveBeenCalledWith('team-1', 'schedule', 'game-1');
        expect(harness.sendEachForMulticast).not.toHaveBeenCalled();
        expect(harness.functions.logger.info).toHaveBeenCalledWith(
            'Notification dedup: skipping duplicate send',
            { teamId: 'team-1', category: 'schedule', gameId: 'game-1' }
        );
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

    it('firestore.rules denies all client access to notificationSendLog', () => {
        const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
        expect(rules).toContain('match /notificationSendLog/{docId}');
        const ruleStart = rules.indexOf('match /notificationSendLog/{docId}');
        const ruleSnippet = rules.slice(ruleStart, ruleStart + 200);
        expect(ruleSnippet).toContain('allow read, write: if false');
    });
});
