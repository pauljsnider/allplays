import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'js/global-search.js'), 'utf8');

describe('legacy global player search fallback', () => {
    it('falls back to team-scoped player queries when collection-group reads are denied', () => {
        expect(source).toContain('async function loadPlayerSearchDocsByTeam(');
        expect(source).toContain("const playersRef = collection(db, `teams/${teamId}/players`);");
        expect(source).toContain('const onlyPermissionDeniedFailures = baseResult.docs.length === 0');
        expect(source).toContain('? await loadPlayerSearchDocsByTeam(prefixes, q, isNumeric, modalState.teamsById)');
    });
});
