import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('public teams visibility', () => {
    it('keeps public team browsing opt-in and preserves accessible private teams by default', () => {
        const source = readRepoFile('js/db.js');

        expect(source).toContain('const publicOnly = options.publicOnly === true;');
        expect(source).toContain('const includePrivate = options.includePrivate === true || includeInactive;');
        expect(source).toContain('} else if (publicOnly) {');
        expect(source).toContain("httpsCallable(functions, 'discoverPublicTeamProfiles')");
        expect(source).toContain('async function getAllPublicTeamProfiles()');
        expect(source).toContain('.sort((a, b) => String(a.name || \'\').localeCompare(String(b.name || \'\')))');
        expect(source).toContain('export async function discoverPublicTeams(options = {})');
        expect(source).toMatch(/export async function discoverPublicTeams[\s\S]*discoverPublicTeamsFromCallable/);
        expect(source).toContain('getDocs(query(teamsRef, where("ownerId", "==", currentUser.uid)))');
        expect(source).toContain('getDocs(query(teamsRef, where("adminEmails", "array-contains", currentUserEmail)))');
        expect(source).not.toContain('const q = includePrivate');
    });

    it('keeps discovery behind the server projection boundary and removes runtime source scans', () => {
        const source = readRepoFile('js/db.js');
        const functionsSource = readRepoFile('functions/index.js');
        expect(source).not.toContain('appendResolvedZipPublicTeamMatches');
        expect(source).not.toContain("const publicTeamsSnapshot = await getDocs(query(teamsRef, where('isPublic', '==', true)));");
        expect(source).not.toContain('await appendResolvedZipPublicTeamMatches(teamsRef, searchDescriptor, teamsById);');
        expect(functionsSource).toContain("const collectionName = useProjection ? 'publicTeamProfiles' : 'teams';");
        expect(functionsSource).toContain(".where('publicSchemaVersion', '==', 1)");
        expect(functionsSource).toContain(".orderBy('name')");
        expect(functionsSource).toContain('PUBLIC_TEAM_DISCOVERY_SCAN_LIMIT = 500');
        expect(functionsSource).toContain("kind: 'public-team-callable-v2'");
        expect(source).not.toContain("teamsRef,\n        where('isPublic', '==', true),");
    });

    it('keeps zip-backed state filters on indexed fields and avoids blocking saves on ZIP resolution', () => {
        const source = readRepoFile('js/db.js');

        expect(source).toContain('searchFields.publicSearchState = normalizePublicTeamSearchValue(teamData.state, { uppercase: true });');
        expect(source).toContain('Object.assign(teamData, buildPublicTeamSearchFields(teamData));');
        expect(source).not.toContain('buildMaterializedPublicTeamSearchFields');
    });

    it('ships a batched backfill script with retry and concurrency guards for zip-only public teams', () => {
        const backfillScript = readRepoFile('_migration/backfill-public-team-search-fields.js');

        expect(backfillScript).toContain("where('isPublic', '==', true)");
        expect(backfillScript).toContain('const ZIP_RESOLVE_CONCURRENCY = 10;');
        expect(backfillScript).toContain('const ZIP_RESOLVE_MAX_ATTEMPTS = 3;');
        expect(backfillScript).toContain('let batch = db.batch();');
        expect(backfillScript).toContain('batch.update(teamDoc.ref, buildSearchFieldPatch(resolvedLocation));');
        expect(backfillScript).toContain('updatedCount += await commitBatch(batch, pendingBatchCount);');
        expect(backfillScript).toContain('await mapWithConcurrency(uniqueZips, ZIP_RESOLVE_CONCURRENCY, async (zip) => {');
    });

    it('wires Browse Teams to the public-only helper path and keeps a defensive client filter', () => {
        const source = readRepoFile('teams.html');

        expect(source).toContain("import { discoverPublicTeams } from './js/db.js?v=107';");
        expect(source).toContain('discoverPublicTeams(locationFilter');
        expect(source).toContain("{ cursor, pageSize: 24 }");
        expect(source).toContain('allTeams.filter(t => t.isPublic === true)');
        expect(source).not.toContain('getTeams(locationFilter ? { locationFilter } : {})');
    });

    it('keeps legacy public source reads during the projection compatibility phase', () => {
        const rules = readRepoFile('firestore.rules');

        expect(rules).toContain('function canReadTeamDocument(data)');
        expect(rules).toContain('function canReadPublicTeamDocument(data)');
        expect(rules).toContain('return canReadPublicTeamDocument(data) ||');
        expect(rules).toContain('allow get: if canReadTeamDocument(resource.data);');
        expect(rules).toContain('allow list: if isBoundedGlobalAdminListQuery() ||');
        expect(rules).toContain('canReadPublicTeamDocument(resource.data) ||');
        expect(rules).toContain('canListManagedTeamDocument(resource.data);');
        expect(rules).toContain('match /publicTeamProfiles/{teamId}');
        expect(rules).not.toContain('allow read: if true;  // Public teams for browsing');
    });
});
