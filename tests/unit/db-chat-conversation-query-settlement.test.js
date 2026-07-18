import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function buildSnapshotLoader() {
    const start = dbSource.indexOf('async function loadChatConversationQuerySnapshots');
    const end = dbSource.indexOf('\nexport async function getChatConversations', start);
    if (start < 0 || end < 0) throw new Error('Unable to find chat conversation query loader.');
    const source = dbSource
        .slice(start, end)
        .replace('async function loadChatConversationQuerySnapshots', 'return async function loadChatConversationQuerySnapshots');
    return new Function('getDocs', source)(vi.fn());
}

describe('chat conversation query settlement', () => {
    it('keeps the modern inbox when a legacy direct query is denied', async () => {
        const loadSnapshots = buildSnapshotLoader();
        const modernSnapshot = { docs: [{ id: 'modern-direct' }] };
        const loadQuery = vi.fn(async (queryName) => {
            if (queryName === 'legacy-direct') {
                throw Object.assign(new Error('Missing or insufficient permissions.'), {
                    code: 'permission-denied'
                });
            }
            return modernSnapshot;
        });

        await expect(loadSnapshots(
            ['modern-direct-user'],
            ['legacy-direct'],
            loadQuery
        )).resolves.toEqual([modernSnapshot]);
        expect(loadQuery).toHaveBeenCalledTimes(2);
    });

    it('includes readable legacy snapshots without hiding required-query failures', async () => {
        const loadSnapshots = buildSnapshotLoader();
        const modernSnapshot = { docs: [{ id: 'modern-direct' }] };
        const legacySnapshot = { docs: [{ id: 'legacy-direct' }] };
        const loadQuery = vi.fn(async (queryName) => (
            queryName === 'legacy-direct' ? legacySnapshot : modernSnapshot
        ));

        await expect(loadSnapshots(
            ['modern-direct-user'],
            ['legacy-direct'],
            loadQuery
        )).resolves.toEqual([modernSnapshot, legacySnapshot]);

        const requiredError = new Error('modern query unavailable');
        await expect(loadSnapshots(
            ['modern-direct-user'],
            [],
            vi.fn().mockRejectedValue(requiredError)
        )).rejects.toBe(requiredError);
    });
});
