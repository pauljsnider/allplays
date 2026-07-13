import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const migrationSource = readFileSync(new URL('../../_migration/backfill-player-parent-links-from-users.js', import.meta.url), 'utf8');

function getFunctionSource(functionName) {
    const signature = migrationSource.indexOf(`function ${functionName}`);
    expect(signature).toBeGreaterThanOrEqual(0);
    const start = migrationSource.lastIndexOf('\n', signature) + 1;
    const parametersEnd = migrationSource.indexOf(')', signature);
    const bodyStart = migrationSource.indexOf('{', parametersEnd + 1);
    let depth = 0;
    for (let index = bodyStart; index < migrationSource.length; index += 1) {
        if (migrationSource[index] === '{') depth += 1;
        if (migrationSource[index] === '}') depth -= 1;
        if (depth === 0) return migrationSource.slice(start, index + 1);
    }
    throw new Error(`Could not extract ${functionName}`);
}

function loadBuildPlayerParentBackfillUpdate() {
    const compactStringSource = getFunctionSource('compactString');
    const compactEmailSource = getFunctionSource('compactEmail');
    const getParentEntryKeySource = getFunctionSource('getParentEntryKey');
    const buildUpdateSource = getFunctionSource('buildPlayerParentBackfillUpdate')
        .replace('export function buildPlayerParentBackfillUpdate', 'function buildPlayerParentBackfillUpdate');

    return new Function(`
        const FieldValue = { serverTimestamp: () => 'server-timestamp' };
        ${compactStringSource}
        ${compactEmailSource}
        ${getParentEntryKeySource}
        ${buildUpdateSource}
        return buildPlayerParentBackfillUpdate;
    `)();
}

function loadApplyPlayerParentBackfill() {
    const compactStringSource = getFunctionSource('compactString');
    const compactEmailSource = getFunctionSource('compactEmail');
    const getParentEntryKeySource = getFunctionSource('getParentEntryKey');
    const buildUpdateSource = getFunctionSource('buildPlayerParentBackfillUpdate')
        .replace('export function buildPlayerParentBackfillUpdate', 'function buildPlayerParentBackfillUpdate');
    const applyBackfillSource = getFunctionSource('applyPlayerParentBackfill')
        .replace('export async function applyPlayerParentBackfill', 'async function applyPlayerParentBackfill');

    return new Function(`
        const FieldValue = { serverTimestamp: () => 'server-timestamp' };
        ${compactStringSource}
        ${compactEmailSource}
        ${getParentEntryKeySource}
        ${buildUpdateSource}
        ${applyBackfillSource}
        return applyPlayerParentBackfill;
    `)();
}

describe('backfill player parent links from users', () => {
    it('adds missing player parent entries from user parentOf links without duplicating existing parents', () => {
        const buildPlayerParentBackfillUpdate = loadBuildPlayerParentBackfillUpdate();
        const result = buildPlayerParentBackfillUpdate({
            parents: [{ userId: 'parent-1', email: 'pat@example.com', relation: 'Dad' }]
        }, [
            { userId: 'parent-1', email: 'pat@example.com', relation: 'Dad' },
            { userId: 'parent-2', email: 'robin@example.com', name: 'Robin Parent', relation: 'Guardian' }
        ]);

        expect(result).toEqual({
            changed: true,
            additions: [
                {
                    userId: 'parent-2',
                    email: 'robin@example.com',
                    name: 'Robin Parent',
                    relation: 'Guardian',
                    status: 'active',
                    source: 'parentOf-backfill'
                }
            ],
            playerUpdate: {
                parents: [
                    { userId: 'parent-1', email: 'pat@example.com', relation: 'Dad' },
                    {
                        userId: 'parent-2',
                        email: 'robin@example.com',
                        name: 'Robin Parent',
                        relation: 'Guardian',
                        status: 'active',
                        source: 'parentOf-backfill'
                    }
                ],
                updatedAt: 'server-timestamp'
            }
        });
    });

    it('documents dry-run default, scoped flags, and apply mode', () => {
        expect(migrationSource).toContain('DRY RUN by default');
        expect(migrationSource).toContain('--apply');
        expect(migrationSource).toContain('--email');
        expect(migrationSource).toContain('--team');
        expect(migrationSource).toContain("db.doc(`teams/${teamId}/players/${playerId}`)");
    });

    it('uses a transaction in apply mode so concurrent parent additions are preserved', async () => {
        const applyPlayerParentBackfill = loadApplyPlayerParentBackfill();
        const playerRef = { get: vi.fn() };
        const transaction = {
            get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({ parents: [{ userId: 'concurrent-parent', relation: 'Parent' }] })
            }),
            set: vi.fn()
        };
        const db = {
            runTransaction: vi.fn(async (callback) => callback(transaction))
        };

        const result = await applyPlayerParentBackfill({
            db,
            playerRef,
            parentEntry: { userId: 'new-parent', email: 'new@example.com', relation: 'Guardian' },
            apply: true
        });

        expect(playerRef.get).not.toHaveBeenCalled();
        expect(db.runTransaction).toHaveBeenCalledTimes(1);
        expect(transaction.get).toHaveBeenCalledWith(playerRef);
        expect(transaction.set).toHaveBeenCalledWith(playerRef, {
            parents: [
                { userId: 'concurrent-parent', relation: 'Parent' },
                {
                    userId: 'new-parent',
                    email: 'new@example.com',
                    name: '',
                    relation: 'Guardian',
                    status: 'active',
                    source: 'parentOf-backfill'
                }
            ],
            updatedAt: 'server-timestamp'
        }, { merge: true });
        expect(result.changed).toBe(true);
    });

    it('keeps dry runs write-free and rejects missing Firestore dependencies', async () => {
        const applyPlayerParentBackfill = loadApplyPlayerParentBackfill();
        const playerRef = {
            get: vi.fn().mockResolvedValue({ exists: false })
        };
        const db = { runTransaction: vi.fn() };

        await expect(applyPlayerParentBackfill({ db: null, playerRef })).rejects.toThrow('Firestore and player reference are required.');
        await expect(applyPlayerParentBackfill({ db, playerRef })).resolves.toEqual({
            missing: true,
            changed: false,
            additions: []
        });
        expect(db.runTransaction).not.toHaveBeenCalled();
    });
});
