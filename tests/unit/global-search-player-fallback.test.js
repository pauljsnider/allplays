import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'js/global-search.js'), 'utf8');

describe('legacy global player search scoping', () => {
    it('queries only accessible team player collections for normal searches', () => {
        expect(source).toContain('async function loadPlayerSearchDocsByTeam(');
        expect(source).toContain('async function loadPlayerSearchDocs(prefixes, rawQuery, isNumeric, teamsById)');
        expect(source).toContain("const playersRef = collection(db, `teams/${teamId}/players`);");
        expect(source).toContain('const result = await loadPlayerSearchDocs(prefixes, q, isNumeric, modalState.teamsById);');
        expect(source).not.toContain("collectionGroup(db, 'players')");
    });
});
