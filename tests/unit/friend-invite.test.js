import { describe, expect, it } from 'vitest';
import {
    FRIEND_INVITE_TYPE,
    buildAcceptedFriendshipData,
    buildFriendInviteAccessCodeData,
    buildFriendInviteInviterProfile,
    buildFriendshipId,
    getSharedTeamContext
} from '../../js/friend-invite.js';

describe('friend invite helpers', () => {
    it('builds deterministic friendship ids from either user order', () => {
        expect(buildFriendshipId('user-b', 'user-a')).toBe('user-a__user-b');
        expect(buildFriendshipId(' user-a ', 'user-b')).toBe('user-a__user-b');
    });

    it('creates typed friend invite access code payloads', () => {
        const now = new Date('2026-07-12T12:00:00Z');
        const expiresAt = new Date('2026-07-19T12:00:00Z');

        expect(buildFriendInviteAccessCodeData({
            code: 'friend12',
            generatedBy: 'inviter-1',
            email: ' friend@example.com ',
            phone: '',
            inviterProfile: {
                fullName: ' Invite Sender ',
                email: 'sender@example.com',
                parentTeamIds: ['private-team'],
                discoveryTeamIds: ['team-1', '']
            },
            now,
            expiresAt
        })).toEqual({
            code: 'FRIEND12',
            type: FRIEND_INVITE_TYPE,
            generatedBy: 'inviter-1',
            email: 'friend@example.com',
            phone: null,
            inviterProfile: {
                displayName: 'Invite Sender',
                fullName: 'Invite Sender',
                photoUrl: null,
                discoveryTeamIds: ['team-1']
            },
            createdAt: now,
            expiresAt,
            used: false,
            usedBy: null,
            usedAt: null
        });
    });

    it('keeps friend invite inviter profiles public and presentation-only', () => {
        expect(buildFriendInviteInviterProfile({
            displayName: ' Sender ',
            fullName: 'Sender Full',
            photoUrl: ' https://example.com/avatar.png ',
            email: 'private@example.com',
            parentOf: [{ teamId: 'secret-team' }],
            discoveryTeamIds: ['team-1', ' team-2 ']
        })).toEqual({
            displayName: 'Sender',
            fullName: 'Sender Full',
            photoUrl: 'https://example.com/avatar.png',
            discoveryTeamIds: ['team-1', 'team-2']
        });
    });

    it('keeps shared team context aligned with Friends tab records', () => {
        const context = getSharedTeamContext(
            {
                parentOf: [{ teamId: 'team-1', teamName: 'Tigers' }],
                coachOf: ['team-2']
            },
            {
                discoveryTeamIds: ['team-1'],
                teams: [{ teamId: 'team-3', teamName: 'Lions' }]
            }
        );

        expect(context).toEqual({
            sharedTeamIds: ['team-1'],
            sharedTeamNames: ['Tigers']
        });
    });

    it('builds accepted friendship records for invite redemption', () => {
        const now = new Date('2026-07-12T12:00:00Z');
        const record = buildAcceptedFriendshipData({
            inviterId: 'inviter-1',
            inviteeId: 'invitee-1',
            inviterProfile: {
                parentOf: [{ teamId: 'team-1', teamName: 'Tigers' }]
            },
            inviteeProfile: {
                parentTeamIds: ['team-1']
            },
            now,
            inviteCodeId: 'code-1'
        });

        expect(record).toMatchObject({
            requesterId: 'inviter-1',
            recipientId: 'invitee-1',
            memberIds: ['invitee-1', 'inviter-1'],
            status: 'accepted',
            sharedTeamIds: ['team-1'],
            sharedTeamNames: ['Tigers'],
            blockedBy: [],
            source: FRIEND_INVITE_TYPE,
            inviteCodeId: 'code-1',
            acceptedAt: now,
            respondedAt: now,
            updatedAt: now
        });
    });

    it('preserves existing friendship member order when accepting a pending record', () => {
        const now = new Date('2026-07-12T12:00:00Z');
        const record = buildAcceptedFriendshipData({
            inviterId: 'inviter-1',
            inviteeId: 'invitee-1',
            existingFriendship: {
                memberIds: ['inviter-1', 'invitee-1'],
                requesterId: 'invitee-1',
                recipientId: 'inviter-1',
                createdAt: 'existing-created-at'
            },
            now,
            inviteCodeId: 'code-2'
        });

        expect(record).toMatchObject({
            requesterId: 'invitee-1',
            recipientId: 'inviter-1',
            memberIds: ['inviter-1', 'invitee-1'],
            status: 'accepted',
            createdAt: 'existing-created-at',
            acceptedAt: now
        });
    });
});
