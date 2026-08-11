import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function readEditConfigSource() {
    return readFileSync(new URL('../../edit-config.html', import.meta.url), 'utf8');
}

function readFirestoreIndexes() {
    return JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8'));
}

describe('edit config delete guard', () => {
    it('delegates deletion to the server-authoritative reference guard', () => {
        const source = readDbSource();

        const start = source.indexOf('export async function deleteConfig(teamId, configId) {');
        const end = source.indexOf('// Stats', start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);

        const block = source.slice(start, end);
        expect(block).toContain("httpsCallable(functions, 'deleteStatConfig')");
        expect(block).toContain('await callable({ teamId, configId })');
        expect(block).toContain("httpsCallable(functions, 'resetTeamStatConfigs')");
        expect(block).not.toContain("collectionGroup(db, 'sharedGames')");
        expect(block).not.toContain('Promise.allSettled');
    });

    it('surfaces a clear alert when deletion is blocked', () => {
        const source = readEditConfigSource();

        const start = source.indexOf("btn.addEventListener('click', async (e) => {");
        const end = source.indexOf('        });', start) + '        });'.length;
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);

        const block = source.slice(start, end);
        expect(block).toContain('try {');
        expect(block).toContain('await deleteConfig(currentTeamId, e.target.dataset.id);');
        expect(block).toContain('loadConfigs();');
        expect(block).toContain('} catch (error) {');
        expect(block).toContain("alert(error?.message || 'Error deleting config.');");
    });

    it('declares the collection-group indexes used by the server reference transaction', () => {
        const sharedOverrides = readFirestoreIndexes().fieldOverrides
            .filter((entry) => entry.collectionGroup === 'sharedGames');

        expect(sharedOverrides).toEqual(expect.arrayContaining([
            expect.objectContaining({
                fieldPath: 'teamIds',
                indexes: expect.arrayContaining([
                    expect.objectContaining({ arrayConfig: 'CONTAINS', queryScope: 'COLLECTION_GROUP' })
                ])
            }),
            expect.objectContaining({
                fieldPath: 'statTrackerConfigId',
                indexes: expect.arrayContaining([
                    expect.objectContaining({ order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' })
                ])
            })
        ]));
    });
});
