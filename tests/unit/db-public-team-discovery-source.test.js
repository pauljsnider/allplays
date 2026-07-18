import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public team discovery source', () => {
    it('materializes public search fields and keeps callable discovery bounded and cursor-resumable', () => {
        const source = readFileSync(resolve(process.cwd(), 'js/db.js'), 'utf8');
        const functionsSource = readFileSync(resolve(process.cwd(), 'functions/index.js'), 'utf8');

        expect(source).toContain("searchFields.publicSearchName = normalizePublicTeamSearchValue(teamData.name);");
        expect(source).toContain("httpsCallable(functions, 'discoverPublicTeamProfiles')");
        expect(functionsSource).toContain('PUBLIC_TEAM_DISCOVERY_SCAN_LIMIT = 500');
        expect(functionsSource).toContain('.orderBy(admin.firestore.FieldPath.documentId())');
        expect(functionsSource).toContain('browseQuery.startAfter(scanCursor.lastName, scanCursor.lastId)');
    });
});
