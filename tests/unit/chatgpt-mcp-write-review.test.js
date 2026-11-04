import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createUserDb } from '../../services/chatgpt-mcp/src/firestoreRest.js';
import { getWriteReviewStatus, normalizeReviewArguments, prepareWriteReview, writeCatalog } from '../../services/chatgpt-mcp/src/writeReview.js';

const requestId = '00112233-4455-4677-8899-aabbccddeeff';
const now = Date.now();
const context = { uid: 'owner', teams: new Map([['team-1', { roles: new Set(['owner']) }]]) };
const input = { action: 'create_schedule_event', requestId, arguments: { teamId: 'team-1', input: { title: 'Practice' } } };
function fakeDb() {
    const records = new Map();
    return {
        records,
        doc: (path) => ({ get: vi.fn(async () => ({ exists: records.has(path), data: () => records.get(path) })) }),
        createReviewRequest: vi.fn(async (docs) => {
            if (docs.some(({ path }) => records.has(path))) throw new Error('ALREADY_EXISTS');
            docs.forEach(({ path, data }) => records.set(path, data));
        })
    };
}

describe('MCP review requests', () => {
    it('covers every current private AI write, including gated resource packets', () => {
        const names = ['privateAiService.ts', 'resourcePacketsAiTools.ts'].flatMap((file) => {
            const source = readFileSync(new URL(`../../apps/app/src/lib/${file}`, import.meta.url), 'utf8');
            return [...source.matchAll(/name: '([^']+)',\s*mode: 'write'/g)].map((match) => match[1]);
        });
        expect(writeCatalog.map((entry) => entry.name).sort()).toEqual(names.sort());
        expect(new Set(names).size).toBe(46);
        expect(JSON.parse(readFileSync(new URL('../../apps/app/src/lib/mcpWriteCatalog.json', import.meta.url), 'utf8'))).toEqual(writeCatalog);
    });
    it('atomically stores only metadata under the user and private payload under manager rules', async () => {
        const db = fakeDb();
        const result = await prepareWriteReview(db, context, input, now);
        expect(result.status).toBe('requested');
        expect(result.requiresAppConfirmation).toBe(true);
        expect(result.reviewUrl).toBe(`https://allplays.ai/app/#/ai/mcp/${requestId}`);
        expect(db.createReviewRequest).toHaveBeenCalledTimes(1);
        const records = [...db.records.values()];
        expect(records[0].args).toEqual({});
        expect(records[0].status).toBe('mcp_request');
        expect(records[0].toolName).toBe('mcp_review_request');
        expect(records[1].args).toEqual(input.arguments);
        expect(records[1].expiresAtAt).toBeInstanceOf(Date);
        expect(JSON.stringify(result)).not.toContain('Practice');
    });
    it('keeps account-only requests in the user boundary', async () => {
        const db = fakeDb();
        await prepareWriteReview(db, context, { ...input, action: 'create_team', arguments: { name: 'Synthetic Bears', sport: 'Soccer' } }, now);
        expect(db.records.size).toBe(1);
        expect([...db.records.values()][0].args.name).toBe('Synthetic Bears');
    });
    it('rejects a parent, stale manager discovery, or arbitrary team id before writing', async () => {
        for (const teams of [new Map(), new Map([['team-1', { roles: new Set(['parent']) }]])]) {
            const db = fakeDb();
            await expect(prepareWriteReview(db, { ...context, teams }, input, now)).rejects.toMatchObject({ code: 'permission_denied' });
            expect(db.createReviewRequest).not.toHaveBeenCalled();
        }
        await expect(prepareWriteReview(fakeDb(), context, { ...input, arguments: { teamId: '../team-1' } }, now)).rejects.toThrow();
    });
    it('deduplicates concurrent requests and reconciles committed lost responses', async () => {
        const db = fakeDb();
        const [one, two] = await Promise.all([prepareWriteReview(db, context, input, now), prepareWriteReview(db, context, input, now)]);
        expect(one).toEqual(two);
        expect(db.records.size).toBe(2);
        const lost = fakeDb();
        const commit = lost.createReviewRequest;
        lost.createReviewRequest = async (docs) => { await commit(docs); throw new Error('response lost'); };
        expect((await prepareWriteReview(lost, context, input, now)).status).toBe('requested');
        expect(lost.records.size).toBe(2);
    });
    it('rejects idempotency-key reuse with changed arguments and never creates a replacement', async () => {
        const db = fakeDb();
        await prepareWriteReview(db, context, input, now);
        await expect(prepareWriteReview(db, context, { ...input, arguments: { teamId: 'team-1', input: { title: 'Changed' } } }, now)).rejects.toMatchObject({ code: 'conflict' });
        expect(db.createReviewRequest).toHaveBeenCalledTimes(1);
    });
    it('does not claim a failed or uncertain persistence attempt succeeded', async () => {
        const db = fakeDb();
        db.createReviewRequest.mockRejectedValue(new Error('denied'));
        await expect(prepareWriteReview(db, context, input, now)).rejects.toMatchObject({ code: 'unavailable' });
        expect(db.records.size).toBe(0);
    });
    it('keeps status user scoped, expiry aware, and revalidates manager access', async () => {
        const db = fakeDb();
        await prepareWriteReview(db, context, input, now);
        expect((await getWriteReviewStatus(db, context, { requestId }, now + 31 * 60000)).status).toBe('expired');
        await expect(getWriteReviewStatus(db, { ...context, uid: 'other' }, { requestId }, now)).rejects.toMatchObject({ code: 'not_found' });
        await expect(getWriteReviewStatus(db, { ...context, teams: new Map() }, { requestId }, now)).rejects.toMatchObject({ code: 'permission_denied' });
    });
    it('rejects execution flags, credentials, prototype keys, invalid ids and oversized inputs', async () => {
        for (const args of [{ __confirmed: true }, { input: { refreshToken: 'synthetic' } }, JSON.parse('{"__proto__":{}}'), { text: 'x'.repeat(200001) }, { n: Infinity }]) {
            expect(() => normalizeReviewArguments(args)).toThrow();
        }
        await expect(prepareWriteReview(fakeDb(), context, { ...input, requestId: '../../escape' }, now)).rejects.toThrow();
        await expect(prepareWriteReview(fakeDb(), context, { ...input, action: 'execute_raw' }, now)).rejects.toThrow();
    });
});

describe('user-credentialed review commit', () => {
    it('uses one create-only REST commit with user bearer and rejects arbitrary business paths', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true }));
        const db = createUserDb({ projectId: 'demo-allplays', idToken: 'synthetic-user', fetchImpl });
        await db.createReviewRequest([{ path: `users/owner/privateAiPendingActions/mcp_${requestId}`, data: { args: {}, createdAt: new Date(now) } }]);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toContain('projects/demo-allplays/databases/(default)/documents:commit');
        expect(options.headers.Authorization).toBe('Bearer synthetic-user');
        expect(JSON.parse(options.body).writes[0].currentDocument).toEqual({ exists: false });
        await expect(db.createReviewRequest([{ path: 'teams/team-1/games/game-1', data: {} }])).rejects.toThrow();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
