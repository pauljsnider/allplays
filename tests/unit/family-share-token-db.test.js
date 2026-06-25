import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function buildCreateFamilyShareToken({ db = {}, doc, setDoc, Timestamp, normalizeFamilyShareChildren, normalizeFamilyShareCalendarUrls }) {
    const start = dbSource.indexOf('function generateShareToken()');
    const end = dbSource.indexOf('\nexport async function updateFamilyShareTokenCalendars', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const functionSource = `${dbSource.slice(start, end)}\nreturn createFamilyShareToken;`
        .replace('export async function createFamilyShareToken', 'async function createFamilyShareToken');

    return new Function('db', 'doc', 'setDoc', 'Timestamp', 'normalizeFamilyShareChildren', 'normalizeFamilyShareCalendarUrls', functionSource)(
        db,
        doc,
        setDoc,
        Timestamp,
        normalizeFamilyShareChildren,
        normalizeFamilyShareCalendarUrls
    );
}

describe('createFamilyShareToken', () => {
    it('writes a bounded expiresAt timestamp on new family share tokens', async () => {
        const originalCrypto = globalThis.crypto;
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: { getRandomValues: vi.fn((bytes) => bytes.fill(1)) }
        });

        const nowMs = Date.parse('2026-06-25T02:30:00Z');
        const fromMillis = vi.fn((millis) => ({ millis, toMillis: () => millis }));
        const Timestamp = {
            now: vi.fn(() => ({ millis: nowMs, toMillis: () => nowMs })),
            fromMillis
        };
        const doc = vi.fn((_db, collectionName, tokenId) => ({ path: `${collectionName}/${tokenId}` }));
        const setDoc = vi.fn().mockResolvedValue();
        const createFamilyShareToken = buildCreateFamilyShareToken({
            doc,
            setDoc,
            Timestamp,
            normalizeFamilyShareChildren: vi.fn((children) => children),
            normalizeFamilyShareCalendarUrls: vi.fn((urls) => urls)
        });

        try {
            const tokenId = await createFamilyShareToken('parent-1', [{ teamId: 'team-1', playerId: 'player-1' }], 'Grandma', ['https://calendar.example.test/feed.ics']);

            expect(tokenId).toMatch(/^[0-9a-f]{40}$/);
            expect(fromMillis).toHaveBeenCalledWith(nowMs + 30 * 24 * 60 * 60 * 1000);
            expect(setDoc).toHaveBeenCalledWith(
                { path: `familyShareTokens/${tokenId}` },
                expect.objectContaining({
                    ownerUserId: 'parent-1',
                    active: true,
                    createdAt: expect.objectContaining({ millis: nowMs }),
                    updatedAt: expect.objectContaining({ millis: nowMs }),
                    expiresAt: expect.objectContaining({ millis: nowMs + 30 * 24 * 60 * 60 * 1000 })
                })
            );
        } finally {
            Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
        }
    });
});
