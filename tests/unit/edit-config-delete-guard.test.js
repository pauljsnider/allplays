import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function readEditConfigSource() {
    return readFileSync(new URL('../../edit-config.html', import.meta.url), 'utf8');
}

describe('edit config delete guard', () => {
    it('blocks deleting configs that existing team games still reference', () => {
        const source = readDbSource();

        const start = source.indexOf('export async function deleteConfig(teamId, configId) {');
        const end = source.indexOf('// Stats', start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);

        const block = source.slice(start, end);
        expect(block).toContain('collection(db, `teams/${teamId}/games`)');
        expect(block).toContain('where("statTrackerConfigId", "==", configId)');
        expect(block).toContain('limit(1)');
        expect(block).toContain('if (!referencingGames.empty || await hasSharedGameUsingConfig(teamId, configId)) {');
        expect(block).toContain("throw new Error('This config is still assigned to one or more games. Remove it from those games before deleting the config.')");
        expect(block).toContain('await deleteDoc(doc(db, `teams/${teamId}/statTrackerConfigs`, configId));');
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
});
