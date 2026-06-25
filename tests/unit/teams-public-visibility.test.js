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
        expect(source).toContain('getDocs(query(teamsRef, where("isPublic", "==", true)))');
        expect(source).toContain('.sort((a, b) => String(a.name || \'\').localeCompare(String(b.name || \'\')))');
        expect(source).toContain('export async function discoverPublicTeams(options = {})');
        expect(source).toContain("where('isPublic', '==', true), orderBy('name')");
        expect(source).toContain('getDocs(query(teamsRef, where("ownerId", "==", currentUser.uid)))');
        expect(source).toContain('getDocs(query(teamsRef, where("adminEmails", "array-contains", currentUserEmail)))');
        expect(source).not.toContain('const q = includePrivate');
    });

    it('keeps discovery on indexed queries and removes the runtime zip-resolution fallback', () => {
        const source = readRepoFile('js/db.js');
        const indexes = JSON.parse(readRepoFile('firestore.indexes.json'));
        const teamIndexes = indexes.indexes
            .filter((index) => index.collectionGroup === 'teams' && index.queryScope === 'COLLECTION')
            .map((index) => index.fields.map((field) => field.fieldPath).join(','));

        expect(source).not.toContain('appendResolvedZipPublicTeamMatches');
        expect(source).not.toContain("const publicTeamsSnapshot = await getDocs(query(teamsRef, where('isPublic', '==', true)));");
        expect(source).not.toContain('await appendResolvedZipPublicTeamMatches(teamsRef, searchDescriptor, teamsById);');
        expect(source).toContain('const snapshots = await Promise.all(strategies.map((strategy) => getDocs(query(');
        expect(teamIndexes).toEqual(expect.arrayContaining([
            'isPublic,publicSearchName',
            'isPublic,name',
            'isPublic,publicSearchCity',
            'isPublic,city',
            'isPublic,publicSearchState',
            'isPublic,state',
            'isPublic,publicSearchZip',
            'isPublic,zip'
        ]));
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

        expect(source).toContain("import { discoverPublicTeams } from './js/db.js?v=71';");
        expect(source).toContain('discoverPublicTeams(locationFilter');
        expect(source).toContain("{ cursor, pageSize: 24 }");
        expect(source).toContain('allTeams.filter(t => t.isPublic === true)');
        expect(source).not.toContain('getTeams(locationFilter ? { locationFilter } : {})');
    });

    it('does not allow anonymous reads of private team documents in Firestore rules', () => {
        const rules = readRepoFile('firestore.rules');

        expect(rules).toContain('function canReadTeamDocument(data)');
        expect(rules).toContain('return (data.isPublic is bool && data.isPublic == true) ||');
        expect(rules).toContain('allow read: if canReadTeamDocument(resource.data);');
        expect(rules).not.toContain('allow read: if true;  // Public teams for browsing');
    });
});
