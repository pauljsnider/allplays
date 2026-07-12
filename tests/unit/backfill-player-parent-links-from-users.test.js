import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migrationSource = readFileSync(new URL('../../_migration/backfill-player-parent-links-from-users.js', import.meta.url), 'utf8');

function getFunctionSource(functionName) {
    const start = migrationSource.indexOf(`function ${functionName}`) !== -1
        ? migrationSource.indexOf(`function ${functionName}`)
        : migrationSource.indexOf(`export function ${functionName}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextFunction = migrationSource.indexOf('\nfunction ', start + 1);
    const nextAsyncFunction = migrationSource.indexOf('\nasync function ', start + 1);
    const nextExportFunction = migrationSource.indexOf('\nexport function ', start + 1);
    const candidates = [nextFunction, nextAsyncFunction, nextExportFunction].filter((value) => value !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : migrationSource.length;
    return migrationSource.slice(start, end);
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
});
