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
        expect(source).toContain('teams = await getAllPublicTeamProjections();');
        expect(source).toContain('.sort((a, b) => String(a.name || \'\').localeCompare(String(b.name || \'\')))');
        expect(source).toContain('export async function discoverPublicTeams(options = {})');
        expect(source).toContain("httpsCallable(functions, 'listPublicTeams')");
        expect(source).toContain('getDocs(query(teamsRef, where("ownerId", "==", currentUser.uid)))');
        expect(source).toContain('getDocs(query(teamsRef, where("adminEmails", "array-contains", currentUserEmail)))');
        expect(source).not.toContain('const q = includePrivate');
    });

    it('keeps discovery on a bounded allowlisted server projection', () => {
        const source = readRepoFile('js/db.js');
        const functionsSource = readRepoFile('functions/index.js');
        const coreSource = readRepoFile('functions/public-team-discovery-core.cjs');

        expect(source).not.toContain('appendResolvedZipPublicTeamMatches');
        expect(source).not.toContain("const publicTeamsSnapshot = await getDocs(query(teamsRef, where('isPublic', '==', true)));");
        expect(source).not.toContain('await appendResolvedZipPublicTeamMatches(teamsRef, searchDescriptor, teamsById);');
        expect(source).toContain("httpsCallable(functions, 'listPublicTeams')");
        expect(functionsSource).toContain('.orderBy(admin.firestore.FieldPath.documentId())');
        expect(functionsSource).toContain('const loadBrowsePage = async ({ afterId, limit: queryLimit }) => {');
        expect(functionsSource).toContain('scanDatastorePublicTeamPage(loadBrowsePage, {');
        expect(functionsSource).toContain('if (afterId) query = query.startAfter(afterId);');
        expect(functionsSource).toContain('hasMore: teamsSnap.size === queryLimit');
        expect(functionsSource).toContain('serializePublicTeamDiscovery(teamSnap.id, teamSnap.data() || {})');
        expect(functionsSource).not.toContain("throwOpportunityError('resource-exhausted', 'Public team discovery is temporarily unavailable.')");
        expect(coreSource).toContain('const PUBLIC_TEAM_DISCOVERY_MAX_SCAN_DOCUMENTS = 200;');
        expect(coreSource).toContain('const PUBLIC_TEAM_DISCOVERY_MAX_PAGE_SIZE = 100;');
    });

    it('keeps zip-backed state filters on indexed fields and avoids blocking saves on ZIP resolution', () => {
        const source = readRepoFile('js/db.js');

        expect(source).toContain("String(team.publicSearchState || team.state || '').trim().toUpperCase().startsWith(normalizedState)");
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

        expect(source).toContain("import { discoverPublicTeams } from './js/db.js?v=4433193';");
        expect(source).toContain('discoverPublicTeams(locationFilter');
        expect(source).toContain("{ cursor, pageSize: 24 }");
        expect(source).toContain('allTeams.filter(t => t.isPublic === true)');
        expect(source).not.toContain('getTeams(locationFilter ? { locationFilter } : {})');
    });

    it('does not allow anonymous reads of private team documents in Firestore rules', () => {
        const rules = readRepoFile('firestore.rules');

        expect(rules).toContain('function canReadTeamDocument(teamId, data)');
        expect(rules).toContain('allow get: if canReadTeamDocument(teamId, resource.data);');
        expect(rules).toContain('allow list: if isBoundedGlobalAdminListQuery(100) ||');
        expect(rules).toContain('canListManagedTeamDocument(resource.data);');
        expect(rules).not.toContain('canReadPublicTeamDocument(resource.data)');
        expect(rules).not.toContain('allow read: if true;  // Public teams for browsing');
    });
});
