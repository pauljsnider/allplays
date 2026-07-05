import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'js/global-search.js'), 'utf8');

describe('legacy global player search scoping', () => {
    it('uses bounded public team discovery instead of bootstrapping the full catalog', () => {
        expect(source).toContain("import { discoverPublicTeams } from './db.js?v=80';");
        expect(source).not.toContain('import { getTeams }');
        expect(source).toContain('const teamSearchQueryLimit = 20;');
        expect(source).toContain('if (q.length < 2) {');
        expect(source).toContain("const result = await discoverPublicTeams({ searchText: q, pageSize: teamSearchQueryLimit });");
        expect(source).not.toContain('const teams = await getTeams();');
    });

    it('queries only accessible team player collections for normal searches', () => {
        expect(source).toContain('player-search-budget.js?v=1');
        expect(source).toContain('async function loadPlayerSearchDocsByTeam(');
        expect(source).toContain('async function loadPlayerSearchDocs(prefixes, rawQuery, isNumeric, teamsById)');
        expect(source).toContain("const playersRef = collection(db, `teams/${teamId}/players`);");
        expect(source).toContain('const result = await loadPlayerSearchDocs(prefixes, q, isNumeric, modalState.teamsById);');
        expect(source).not.toContain("collectionGroup(db, 'players')");
    });

    it('limits legacy player fan-out to a bounded set of searchable teams and queries', () => {
        expect(source).toContain('const playerSearchQueryLimit = playerSearchResultLimit;');
        expect(source).toContain('const playerSearchTeamLimit = 8;');
        expect(source).toContain('function getPlayerSearchTeamIds(rawQuery, teamsById)');
        expect(source).toContain('filterSearchableTeams(Array.from(teamsById.values()), currentUser)');
        expect(source).toContain('.slice(0, playerSearchTeamLimit)');
        expect(source).toContain('const teamIds = getPlayerSearchTeamIds(rawQuery, teamsById);');
        expect(source).toContain('executeBoundedPlayerSearch({');
        expect(source).toContain('queryBudget: playerSearchFirestoreQueryBudget');
    });

    it('avoids unreadable stream-only team queries when loading accessible teams', () => {
        expect(source).toContain("teamQueries.push(getDocs(query(teamsRef, where('ownerId', '==', uid))));");
        expect(source).toContain("teamQueries.push(getDocs(query(teamsRef, where('adminEmails', 'array-contains', email))));");
        expect(source).not.toContain("teamPermissions.streaming.memberIds");
        expect(source).not.toContain("streamVolunteerEmails");
    });
});
