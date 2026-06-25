import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    buildOfficialLookupCacheKey,
    buildOfficialUserLookup,
    collectOfficialLookupQueryTargets,
    collectOfficialLookupTargets,
    formatOfficialUserSummary,
    getOfficialUserSummary,
    matchesOfficialUserSearch
} from '../../js/admin-user-official-links.js';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('admin users official links', () => {
    it('groups official directory matches by normalized email and team context', () => {
        const lookup = buildOfficialUserLookup([
            {
                teamId: 'team-1',
                teamName: 'Blue Jays',
                official: { email: 'Ref@One.com', name: 'Robin Ref' }
            },
            {
                teamId: 'team-2',
                teamName: 'Storm',
                official: { email: 'ref@one.com', name: 'Robin Ref' }
            },
            {
                teamId: 'team-3',
                teamName: 'Wolves',
                official: { email: 'other@example.com', name: 'Other Official' }
            }
        ]);

        const summary = getOfficialUserSummary({ email: 'REF@one.com' }, lookup);

        expect(summary).toEqual({
            email: 'ref@one.com',
            phone: null,
            teamIds: ['team-1', 'team-2'],
            teamNames: ['Blue Jays', 'Storm'],
            officialNames: ['Robin Ref'],
            teamCount: 2
        });
        expect(formatOfficialUserSummary(summary)).toBe('2 teams: Blue Jays, Storm');
        expect(matchesOfficialUserSearch({ fullName: 'Robin Ref' }, summary, 'storm')).toBe(true);
        expect(matchesOfficialUserSearch({ fullName: 'Robin Ref' }, summary, 'official')).toBe(true);
        expect(matchesOfficialUserSearch({ fullName: 'Robin Ref' }, summary, 'wolves')).toBe(false);
    });

    it('matches phone-only officials by normalized phone number', () => {
        const lookup = buildOfficialUserLookup([
            {
                teamId: 'team-4',
                teamName: 'Falcons',
                official: { phone: '+1 (555) 123-4567', name: 'Pat Phone' }
            }
        ]);

        const summary = getOfficialUserSummary({ phone: '5551234567' }, lookup);

        expect(summary).toEqual({
            email: null,
            phone: '5551234567',
            teamIds: ['team-4'],
            teamNames: ['Falcons'],
            officialNames: ['Pat Phone'],
            teamCount: 1
        });
        expect(formatOfficialUserSummary(summary)).toBe('1 team: Falcons');
    });

    it('collects bounded lookup targets from only the visible users slice', () => {
        const users = [
            { id: 'user-1', email: ' Ref@One.com ', phone: '+1 (555) 123-4567' },
            { id: 'user-2', email: 'ref@one.com', phone: '5551234567' },
            { id: 'user-3', email: 'other@example.com', phone: '' }
        ];

        expect(collectOfficialLookupTargets(users)).toEqual({
            emails: ['ref@one.com', 'other@example.com'],
            phones: ['5551234567']
        });
        expect(collectOfficialLookupQueryTargets(users)).toEqual({
            emails: ['Ref@One.com', 'ref@one.com', 'other@example.com'],
            phones: ['+1 (555) 123-4567', '5551234567']
        });
        expect(buildOfficialLookupCacheKey(users)).toBe('user-1:ref@one.com:5551234567|user-2:ref@one.com:5551234567|user-3:other@example.com:');
    });

    it('wires the admin users tab to show and filter official-linked users for the visible page', () => {
        const adminHtml = readSource('admin.html');
        const adminJs = readSource('js/admin.js');
        const dbJs = readSource('js/db.js');

        expect(adminHtml).toContain('id="filter-users-official-status"');
        expect(adminHtml).toContain('Officials only');
        expect(adminHtml).toContain('Search users, officials, or teams...');
        expect(adminHtml).toContain('Official</th>');

        expect(adminJs).toContain('getOfficials');
        expect(adminJs).toContain('getOfficialsForUsers');
        expect(adminJs).toContain('loadVisibleOfficialUserLinks(getCurrentUsersPage())');
        expect(adminJs).not.toContain("loadOfficialUserLinks(getDashboardTeams(), { scope: 'all' })");
        expect(dbJs).toContain("collectionGroup(db, 'officials')");
        expect(dbJs).toContain('collectOfficialLookupQueryTargets');
        expect(dbJs).toContain("where('email', 'in', chunk)");
        expect(adminJs).toContain('buildOfficialUserLookup');
        expect(adminJs).toContain('formatOfficialUserSummary');
        expect(adminJs).toContain('matchesOfficialUserSearch');
        expect(adminJs).toContain("officialFilter === 'officials'");
        expect(adminJs).toContain('inline-flex items-center rounded-full bg-emerald-100');
    });

    it('refreshes team-page and users-page official loaders separately', () => {
        const adminJs = readSource('js/admin.js');

        expect(adminJs).toContain("async function ensureCurrentTeamOfficialsLoaded() {");
        expect(adminJs).toContain("await loadOfficialUserLinks(getCurrentTeamPage(), { scope: 'page' });");
        expect(adminJs).toContain("async function ensureCurrentUsersOfficialsLoaded() {");
        expect(adminJs).toContain("await loadVisibleOfficialUserLinks(getCurrentUsersPage());");
        expect(adminJs).toContain('await ensureCurrentUsersOfficialsLoaded();');
    });
});
