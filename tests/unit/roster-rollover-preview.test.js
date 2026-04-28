import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
    buildRosterRolloverPreviewRows,
    getLinkedFamilyCount,
    getVisibleContactCount
} from '../../js/roster-rollover-preview.js';

describe('roster rollover preview', () => {
    it('builds active-player preview rows with linked family and visible contact counts', () => {
        const rows = buildRosterRolloverPreviewRows([
            {
                id: 'inactive',
                name: 'Inactive Player',
                number: '1',
                active: false,
                parents: [{ email: 'inactive@example.com' }]
            },
            {
                id: 'p2',
                name: 'Taylor',
                number: '12',
                parents: [{ email: 'pending' }, { email: 'parent@example.com' }]
            },
            {
                id: 'p1',
                name: 'Jordan',
                number: '3',
                parents: []
            }
        ]);

        expect(rows).toEqual([
            {
                id: 'p1',
                name: 'Jordan',
                number: '3',
                familyCount: 0,
                contactCount: 0
            },
            {
                id: 'p2',
                name: 'Taylor',
                number: '12',
                familyCount: 2,
                contactCount: 1
            }
        ]);
    });

    it('counts player family links separately from visible contacts', () => {
        const player = {
            parents: [
                { email: 'pending' },
                { email: '' },
                { email: 'family@example.com' }
            ]
        };

        expect(getLinkedFamilyCount(player)).toBe(3);
        expect(getVisibleContactCount(player)).toBe(1);
    });

    it('wires the preview-only rollover control into team creation', () => {
        const html = readFileSync(new URL('../../edit-team.html', import.meta.url), 'utf8');

        expect(html).toContain('Roll Over Previous Roster');
        expect(html).toContain('getUserProfile(user.uid)');
        expect(html).toContain("const accessEmail = currentUser.email || currentUserProfile?.email || '';");
        expect(html).toContain('getUserTeamsWithAccess(currentUser.uid, accessEmail)');
        expect(html).toContain('const requestId = ++rosterRolloverPreviewRequestId;');
        expect(html).toContain('requestId !== rosterRolloverPreviewRequestId || select.value !== sourceTeamId');
        expect(html).toContain('getPlayers(sourceTeamId)');
        expect(html).toContain('Nothing will be copied when this team is saved.');
        expect(html).not.toContain('rolloverSourceTeamId');
    });
});
