import { describe, expect, it } from 'vitest';
import {
    buildStaffTeamIndexes,
    resolveProjectionTeamIds
} from '../../_migration/backfill-public-user-profiles.js';

function team(id, data) {
    return { id, data: () => data };
}

describe('public user profile backfill', () => {
    it('indexes team owners and case-insensitive admin emails', () => {
        const indexes = buildStaffTeamIndexes([
            team('team-1', {
                ownerId: 'owner-1',
                adminEmails: ['Tim@Example.com']
            })
        ]);

        expect([...indexes.ownerTeamIds.get('owner-1')]).toEqual(['team-1']);
        expect([...indexes.adminTeamIds.get('tim@example.com')]).toEqual(['team-1']);
    });

    it('combines parent, owner, and coach memberships for an existing user', () => {
        const indexes = buildStaffTeamIndexes([
            team('team-coach', { adminEmails: ['tim@example.com'] }),
            team('team-owned', { ownerId: 'user-1' })
        ]);

        expect(resolveProjectionTeamIds(
            'user-1',
            { parentTeamIds: ['team-parent'], email: 'old@example.com' },
            { email: 'Tim@Example.com' },
            indexes
        )).toEqual(['team-parent', 'team-owned', 'team-coach']);
    });
});
