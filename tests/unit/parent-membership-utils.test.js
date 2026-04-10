import { describe, it, expect } from 'vitest';
import {
    buildParentMembershipRequestId,
    buildParentMembershipRequestUpdate,
    hasParentLink,
    mergeApprovedParentLinkState,
    mergeApprovedParentMembershipRequests
} from '../../js/parent-membership-utils.js';

describe('parent membership utils', () => {
    it('builds a stable request id per requester and player', () => {
        expect(buildParentMembershipRequestId('user-1', 'player-9')).toBe('user-1__player-9');
    });

    it('merges parent link state without duplicating existing links', () => {
        const result = mergeApprovedParentLinkState({
            userData: {
                roles: ['member', 'parent'],
                parentOf: [
                    { teamId: 'team-1', playerId: 'player-9', playerName: 'Avery Lee' }
                ],
                parentTeamIds: ['team-1'],
                parentPlayerKeys: ['team-1::player-9']
            },
            parentUserId: 'user-1',
            parentEmail: 'parent@example.com',
            team: { id: 'team-1', name: 'Falcons' },
            player: { id: 'player-9', name: 'Avery Lee', number: '9', photoUrl: 'https://img/9.png' },
            relation: 'Guardian'
        });

        expect(result.userUpdate.roles).toEqual(['member', 'parent']);
        expect(result.userUpdate.parentOf).toHaveLength(1);
        expect(result.userUpdate.parentTeamIds).toEqual(['team-1']);
        expect(result.userUpdate.parentPlayerKeys).toEqual(['team-1::player-9']);
        expect(result.playerParentEntry).toMatchObject({
            userId: 'user-1',
            email: 'parent@example.com',
            relation: 'Guardian'
        });
    });

    it('detects an existing parent link for the same team and player', () => {
        expect(hasParentLink({
            parentOf: [
                { teamId: 'team-1', playerId: 'player-9' },
                { teamId: 'team-2', playerId: 'player-3' }
            ]
        }, 'team-1', 'player-9')).toBe(true);

        expect(hasParentLink({
            parentOf: [
                { teamId: 'team-1', playerId: 'player-9' }
            ]
        }, 'team-1', 'player-8')).toBe(false);
    });

    it('allows only valid request status transitions', () => {
        expect(buildParentMembershipRequestUpdate({
            currentStatus: 'pending',
            nextStatus: 'approved',
            decidedBy: 'coach-1'
        })).toMatchObject({
            status: 'approved',
            decidedBy: 'coach-1'
        });

        expect(() => buildParentMembershipRequestUpdate({
            currentStatus: 'approved',
            nextStatus: 'denied',
            decidedBy: 'coach-1'
        })).toThrow('Only pending requests can be decided');
    });

    it('merges approved membership requests into the requester profile without duplicates', () => {
        const result = mergeApprovedParentMembershipRequests({
            email: 'parent@example.com',
            roles: ['member'],
            parentOf: [
                { teamId: 'team-1', playerId: 'player-9', playerName: 'Avery Lee' }
            ],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-9']
        }, [
            {
                status: 'approved',
                requesterUserId: 'user-1',
                requesterEmail: 'parent@example.com',
                teamId: 'team-1',
                teamName: 'Falcons',
                playerId: 'player-9',
                playerName: 'Avery Lee',
                playerNumber: '9',
                relation: 'Guardian'
            },
            {
                status: 'approved',
                requesterUserId: 'user-1',
                requesterEmail: 'parent@example.com',
                teamId: 'team-2',
                teamName: 'Tigers',
                playerId: 'player-3',
                playerName: 'Jordan Cruz',
                playerNumber: '3',
                relation: 'Parent'
            }
        ]);

        expect(result.changed).toBe(true);
        expect(result.userUpdate.roles).toEqual(['member', 'parent']);
        expect(result.userUpdate.parentOf).toHaveLength(2);
        expect(result.userUpdate.parentTeamIds).toEqual(['team-1', 'team-2']);
        expect(result.userUpdate.parentPlayerKeys).toEqual(['team-1::player-9', 'team-2::player-3']);
    });
});
