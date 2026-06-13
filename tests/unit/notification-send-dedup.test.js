import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

// Extract checkAndSetNotificationDedup as a standalone testable function.
// We isolate just the helper and provide a mock Firestore and admin.
function buildDedupHelper({ nowMs, existingSentAtMs = null } = {}) {
    const mockDocRef = {};
    const mockFirestore = {
        doc: vi.fn(() => mockDocRef),
        runTransaction: vi.fn(async (fn) => {
            const snap = {
                exists: existingSentAtMs !== null,
                data: () => existingSentAtMs !== null
                    ? { sentAt: { toMillis: () => existingSentAtMs } }
                    : undefined
            };
            const txn = {
                get: vi.fn(async () => snap),
                set: vi.fn()
            };
            return fn(txn);
        })
    };
    const mockAdmin = {
        firestore: {
            FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') }
        }
    };

    // Extract the constant and function body from the source
    const windowStart = functionsSource.indexOf('const NOTIFICATION_DEDUP_WINDOW_MS');
    const fnStart = functionsSource.indexOf('async function checkAndSetNotificationDedup');
    const fnEnd = functionsSource.indexOf('\nasync function sendCategoryNotification');
    const helperSource = functionsSource.slice(windowStart, fnEnd);

    // Inject fixed Date.now when provided
    const dateNow = nowMs !== undefined ? `const _origDateNow = Date.now; Date.now = () => ${nowMs};` : '';

    // eslint-disable-next-line no-new-func
    const factory = new Function(
        'firestore', 'admin', 'crypto',
        `${dateNow}
         ${helperSource}
         return checkAndSetNotificationDedup;`
    );

    const cryptoModule = require('node:crypto');
    return { fn: factory(mockFirestore, mockAdmin, cryptoModule), mockFirestore, mockAdmin };
}

// Require is not available in ESM by default; use createRequire.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

describe('notification send dedup guard — checkAndSetNotificationDedup', () => {
    it('returns true and writes the dedup record when no prior send exists', async () => {
        const now = Date.now();
        const { fn, mockFirestore } = buildDedupHelper({ nowMs: now, existingSentAtMs: null });

        const result = await fn('team-1', 'schedule', 'game-1');

        expect(result).toBe(true);
        expect(mockFirestore.runTransaction).toHaveBeenCalledOnce();
    });

    it('returns false when an existing send occurred within the 5-minute window', async () => {
        const now = Date.now();
        const fourMinutesAgo = now - 4 * 60 * 1000;
        const { fn } = buildDedupHelper({ nowMs: now, existingSentAtMs: fourMinutesAgo });

        const result = await fn('team-1', 'schedule', 'game-1');

        expect(result).toBe(false);
    });

    it('returns true when a prior send exists but is older than the 5-minute window', async () => {
        const now = Date.now();
        const sixMinutesAgo = now - 6 * 60 * 1000;
        const { fn } = buildDedupHelper({ nowMs: now, existingSentAtMs: sixMinutesAgo });

        const result = await fn('team-1', 'schedule', 'game-1');

        expect(result).toBe(true);
    });

    it('uses different hash keys for different gameIds so they do not interfere', async () => {
        const now = Date.now();
        // existingSentAtMs within window — but we track the doc ref path, which must differ per gameId
        const { fn: fn1, mockFirestore: mf1 } = buildDedupHelper({ nowMs: now, existingSentAtMs: null });
        const { fn: fn2, mockFirestore: mf2 } = buildDedupHelper({ nowMs: now, existingSentAtMs: null });

        const result1 = await fn1('team-1', 'schedule', 'game-A');
        const result2 = await fn2('team-1', 'schedule', 'game-B');

        const docPath1 = mf1.doc.mock.calls[0][0];
        const docPath2 = mf2.doc.mock.calls[0][0];

        expect(result1).toBe(true);
        expect(result2).toBe(true);
        // Different gameIds must produce different document paths (hashes differ)
        expect(docPath1).not.toBe(docPath2);
    });
});

describe('notification send dedup guard — sendCategoryNotification wiring', () => {
    it('defines the NOTIFICATION_DEDUP_WINDOW_MS constant as 5 minutes', () => {
        expect(functionsSource).toContain('const NOTIFICATION_DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes');
    });

    it('defines checkAndSetNotificationDedup with a Firestore transaction', () => {
        expect(functionsSource).toContain('async function checkAndSetNotificationDedup(teamId, category, gameId)');
        expect(functionsSource).toContain('firestore.runTransaction(async (txn) =>');
        expect(functionsSource).toContain('teams/${teamId}/notificationSendLog/${hash}');
        expect(functionsSource).toContain('return false; // duplicate within window');
        expect(functionsSource).toContain('return true; // ok to send');
    });

    it('calls checkAndSetNotificationDedup inside sendCategoryNotification before sending', () => {
        const sendFnStart = functionsSource.indexOf('async function sendCategoryNotification');
        const sendFnBody = functionsSource.slice(sendFnStart, sendFnStart + 2000);

        expect(sendFnBody).toContain('ALWAYS_SEND_CATEGORIES');
        expect(sendFnBody).toContain("new Set(['liveScore', 'mentions'])");
        expect(sendFnBody).toContain('checkAndSetNotificationDedup(teamId, category, gameId)');
        expect(sendFnBody).toContain('Notification dedup: skipping duplicate send');
        expect(sendFnBody).toContain('return null;');
    });

    it('bypasses dedup for liveScore category', () => {
        const sendFnStart = functionsSource.indexOf('async function sendCategoryNotification');
        const sendFnBody = functionsSource.slice(sendFnStart, sendFnStart + 2000);

        // liveScore must be in ALWAYS_SEND_CATEGORIES so it skips the dedup check
        expect(sendFnBody).toContain("'liveScore'");
        expect(sendFnBody).toContain("'mentions'");
        // The guard must be conditional: only runs when NOT in ALWAYS_SEND_CATEGORIES
        expect(sendFnBody).toContain('!ALWAYS_SEND_CATEGORIES.has(category)');
    });

    it('writes dedup records under teams/{teamId}/notificationSendLog/{hash}', () => {
        expect(functionsSource).toContain('teams/${teamId}/notificationSendLog/${hash}');
        // Dedup record stores teamId, category, gameId, and sentAt
        const dedupFnStart = functionsSource.indexOf('async function checkAndSetNotificationDedup');
        const dedupFnEnd = functionsSource.indexOf('\nasync function sendCategoryNotification');
        const dedupBody = functionsSource.slice(dedupFnStart, dedupFnEnd);
        expect(dedupBody).toContain('teamId,');
        expect(dedupBody).toContain('category,');
        expect(dedupBody).toContain('gameId: gameId || null,');
        expect(dedupBody).toContain('sentAt: admin.firestore.FieldValue.serverTimestamp()');
    });

    it('firestore.rules denies all client access to notificationSendLog', () => {
        const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
        expect(rules).toContain('match /notificationSendLog/{docId}');
        const ruleStart = rules.indexOf('match /notificationSendLog/{docId}');
        const ruleSnippet = rules.slice(ruleStart, ruleStart + 200);
        expect(ruleSnippet).toContain('allow read, write: if false');
    });
});
