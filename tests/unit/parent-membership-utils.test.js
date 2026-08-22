import { describe, it, expect } from 'vitest';
import {
    buildParentMembershipRequestId,
    buildParentMembershipRequestUpdate,
    hasParentLink,
    mergeApprovedParentLinkState,
    mergeApprovedParentMembershipRequests,
    removeParentLinkState
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
            ],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: []
        }, 'team-1', 'player-8')).toBe(false);

        expect(hasParentLink({
            parentOf: [{ teamId: 'team-1', playerId: 'player-9' }],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: []
        }, 'team-1', 'player-9')).toBe(false);
    });

    it('removes an exact canonical parent link without restoring stale metadata', () => {
        const result = removeParentLinkState({
            parentOf: [
                { teamId: 'team-1', playerId: 'player-1' },
                { teamId: 'team-1', playerId: 'player-revoked' },
                { teamId: 'team-stale', playerId: 'player-stale' }
            ],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-1', 'team-1::player-revoked']
        }, 'team-1', 'player-1');

        expect(result).toEqual({
            parentOf: [{ teamId: 'team-1', playerId: 'player-revoked' }],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-revoked']
        });
    });

    it('seals partial canonical profiles instead of deriving missing grants from parentOf', () => {
        expect(removeParentLinkState({
            parentOf: [
                { teamId: 'team-1', playerId: 'player-1' },
                { teamId: 'team-2', playerId: 'player-stale' }
            ],
            parentTeamIds: ['team-1', 'team-2']
        }, 'team-1', 'player-1')).toEqual({
            parentOf: [],
            parentTeamIds: ['team-2'],
            parentPlayerKeys: []
        });

        expect(removeParentLinkState({
            parentOf: [
                { teamId: 'team-1', playerId: 'player-1' },
                { teamId: 'team-stale', playerId: 'player-stale' }
            ],
            parentPlayerKeys: ['team-1::player-1']
        }, 'team-1', 'player-1')).toEqual({
            parentOf: [],
            parentTeamIds: [],
            parentPlayerKeys: []
        });
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
            ]
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

    it('never restores revoked canonical grants from approved request history', () => {
        const userData = {
            email: 'parent@example.com',
            roles: ['parent'],
            parentOf: [
                { teamId: 'team-1', playerId: 'player-1' },
                { teamId: 'team-1', playerId: 'player-revoked' }
            ],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-1']
        };
        const approvedRequests = [
            { status: 'approved', teamId: 'team-1', playerId: 'player-revoked' },
            { status: 'approved', teamId: 'team-1', playerId: 'player-3' }
        ];

        const result = mergeApprovedParentMembershipRequests(userData, approvedRequests);

        expect(result.changed).toBe(false);
        expect(result.userUpdate.parentTeamIds).toEqual(['team-1']);
        expect(result.userUpdate.parentPlayerKeys).toEqual(['team-1::player-1']);
        expect(result.userUpdate.parentOf).toEqual(userData.parentOf);
    });

    it('does not let an unrelated approval restore a canonically removed team', () => {
        const result = mergeApprovedParentMembershipRequests({
            parentOf: [
                { teamId: 'team-removed', playerId: 'player-old' },
                { teamId: 'team-current', playerId: 'player-current' }
            ],
            parentTeamIds: ['team-current'],
            parentPlayerKeys: ['team-current::player-current']
        }, [
            { status: 'approved', teamId: 'team-new', playerId: 'player-new' }
        ]);

        expect(result.changed).toBe(false);
        expect(result.userUpdate.parentTeamIds).toEqual(['team-current']);
        expect(result.userUpdate.parentPlayerKeys).toEqual(['team-current::player-current']);
    });
});
