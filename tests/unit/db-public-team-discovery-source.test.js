import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public team discovery source', () => {
    it('maintains bounded team-name search strategies alongside location search', () => {
        const source = readFileSync(resolve(process.cwd(), 'js/db.js'), 'utf8');

        expect(source).toContain("searchFields.publicSearchName = normalizePublicTeamSearchValue(teamData.name);");
        expect(source).toContain("{ field: 'publicSearchName', start: normalizedName, end: `${normalizedName}\\uf8ff` }");
        expect(source).toContain("{ field: 'name', start: legacyNameSearch, end: `${legacyNameSearch}\\uf8ff` }");
    });
});
