import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    buildOfficialUserLookup,
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

    it('wires the admin users tab to show and filter official-linked users', () => {
        const adminHtml = readSource('admin.html');
        const adminJs = readSource('js/admin.js');

        expect(adminHtml).toContain('id="filter-users-official-status"');
        expect(adminHtml).toContain('Officials only');
        expect(adminHtml).toContain('Search users, officials, or teams...');
        expect(adminHtml).toContain('Official</th>');

        expect(adminJs).toContain('getOfficials');
        expect(adminJs).toContain('loadOfficialUserLinks()');
        expect(adminJs).toContain('buildOfficialUserLookup');
        expect(adminJs).toContain('formatOfficialUserSummary');
        expect(adminJs).toContain('matchesOfficialUserSearch');
        expect(adminJs).toContain("officialFilter === 'officials'");
        expect(adminJs).toContain('inline-flex items-center rounded-full bg-emerald-100');
    });
});
