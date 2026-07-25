import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAccessTokenBackfill } from '../../_migration/backfill-admin-user-search-index.js';

function jsonResponse(body, { ok = true, status = 200, text = '' } = {}) {
    return {
        ok,
        status,
        json: vi.fn().mockResolvedValue(body),
        text: vi.fn().mockResolvedValue(text)
    };
}

function queryDocument(index) {
    return {
        document: {
            name: `projects/test-project/databases/(default)/documents/users/user-${index}`,
            fields: {
                email: { stringValue: `User-${index}@Example.com` },
                fullName: { stringValue: `User ${index}` },
                phone: { stringValue: `555000${String(index).padStart(4, '0')}` }
            }
        }
    };
}

describe('admin user search REST backfill', () => {
    let logSpy;

    beforeEach(() => {
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('decodes query documents without writing during a dry run', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
            queryDocument(1),
            { readTime: '2026-07-25T00:00:00Z' }
        ]));
        vi.stubGlobal('fetch', fetchMock);

        await runAccessTokenBackfill('token', { apply: false });

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
            structuredQuery: {
                from: [{ collectionId: 'users' }]
            }
        });
        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('Would index user-1')
        );
        expect(logSpy).toHaveBeenLastCalledWith(
            '[backfill-admin-user-search-index] Done. Would write 1 index document(s).'
        );
    });

    it('chunks apply writes into requests of at most 20 documents', async () => {
        const documents = Array.from({ length: 21 }, (_, index) => queryDocument(index));
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse(documents))
            .mockResolvedValueOnce(jsonResponse({
                status: Array.from({ length: 20 }, () => ({}))
            }))
            .mockResolvedValueOnce(jsonResponse({ status: [{}] }));
        vi.stubGlobal('fetch', fetchMock);

        await runAccessTokenBackfill('token', { apply: true });

        const firstBatch = JSON.parse(fetchMock.mock.calls[1][1].body).writes;
        const secondBatch = JSON.parse(fetchMock.mock.calls[2][1].body).writes;
        expect(firstBatch).toHaveLength(20);
        expect(secondBatch).toHaveLength(1);
        expect(firstBatch[0]).toMatchObject({
            update: {
                fields: {
                    userId: { stringValue: 'user-0' },
                    hashes: {
                        arrayValue: {
                            values: expect.arrayContaining([
                                { stringValue: '1wahw2d' }
                            ])
                        }
                    }
                }
            }
        });
        expect(logSpy).toHaveBeenLastCalledWith(
            '[backfill-admin-user-search-index] Done. Wrote 21 index document(s).'
        );
    });

    it('reports Firestore HTTP errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            jsonResponse(null, { ok: false, status: 403, text: 'permission denied' })
        ));

        await expect(runAccessTokenBackfill('token', { apply: true }))
            .rejects.toThrow('Firestore REST 403: permission denied');
    });

    it.each([
        ['missing', {}],
        ['short', { status: [] }]
    ])('rejects %s batch status arrays', async (_label, batchResponse) => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse([queryDocument(1)]))
            .mockResolvedValueOnce(jsonResponse(batchResponse)));

        await expect(runAccessTokenBackfill('token', { apply: true }))
            .rejects.toThrow('returned 0 status entries for 1 writes');
    });

    it('rejects nonzero per-write statuses', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse([queryDocument(1)]))
            .mockResolvedValueOnce(jsonResponse({
                status: [{ code: 7, message: 'permission denied' }]
            })));

        await expect(runAccessTokenBackfill('token', { apply: true }))
            .rejects.toThrow('batch write failed (7): permission denied');
    });
});
