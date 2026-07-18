import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    canMessageAcceptedFriendForTeam,
    createCheckAcceptedFriendMessageAccessHandler
} = require('../../functions/friend-message-access-core.cjs');

const friendship = {
    status: 'accepted',
    memberIds: ['parent-1', 'owner-1'],
    sharedTeamIds: ['team-1']
};

function check(overrides = {}) {
    return canMessageAcceptedFriendForTeam({
        friendship,
        team: {
            ownerId: 'owner-1',
            adminEmails: []
        },
        sender: { parentTeamIds: ['team-1'], email: 'parent@example.com' },
        recipient: { email: 'owner@example.com' },
        senderId: 'parent-1',
        recipientId: 'owner-1',
        teamId: 'team-1',
        ...overrides
    });
}

describe('friend message access core', () => {
    it('allows private-team parent-to-owner messaging using server-readable membership', () => {
        expect(check()).toBe(true);
    });

    it('accepts legacy parentOf membership when parentTeamIds has not been backfilled', () => {
        expect(check({
            sender: {
                parentOf: [{ teamId: 'team-1', playerId: 'player-1' }],
                email: 'parent@example.com'
            }
        })).toBe(true);
        expect(check({
            sender: {
                parentOf: [{ teamId: 'other-team', playerId: 'player-1' }],
                email: 'parent@example.com'
            }
        })).toBe(false);
    });

    it('allows owner-to-parent and parent-to-admin messaging', () => {
        expect(check({
            sender: { email: 'owner@example.com' },
            recipient: { parentTeamIds: ['team-1'], email: 'parent@example.com' },
            senderId: 'owner-1',
            recipientId: 'parent-1'
        })).toBe(true);
        expect(check({
            friendship: { ...friendship, memberIds: ['parent-1', 'admin-1'] },
            team: {
                ownerId: 'owner-1',
                adminEmails: ['admin@example.com']
            },
            recipient: { email: 'ADMIN@example.com' },
            recipientId: 'admin-1'
        })).toBe(true);
    });

    it('denies stale friendships and recipients that are no longer messageable', () => {
        expect(check({
            friendship: { ...friendship, memberIds: ['parent-1', 'former-parent'] },
            recipient: {},
            recipientId: 'former-parent',
            team: {
                ownerId: 'owner-1'
            }
        })).toBe(false);
        expect(check({ team: { ownerId: 'someone-else' } })).toBe(false);
        expect(check({ sender: { email: 'former-parent@example.com' } })).toBe(false);
        expect(check({ friendship: { ...friendship, status: 'pending' } })).toBe(false);
        expect(check({ friendship: { ...friendship, sharedTeamIds: ['team-2'] } })).toBe(false);
    });

    it('wires a callable handler that reads private team and user records server-side', async () => {
        const documents = new Map([
            ['friendships/owner-1__parent-1', friendship],
            ['teams/team-1', { ownerId: 'owner-1' }],
            ['users/parent-1', {
                parentOf: [{ teamId: 'team-1', playerId: 'player-1' }],
                email: 'parent@example.com'
            }],
            ['users/owner-1', { email: 'owner@example.com' }]
        ]);
        const reads = [];
        const firestore = {
            doc(path) {
                reads.push(path);
                return {
                    async get() {
                        const value = documents.get(path);
                        return { exists: value !== undefined, data: () => value };
                    }
                };
            }
        };
        class HttpsError extends Error {
            constructor(code, message) {
                super(message);
                this.code = code;
            }
        }
        const handler = createCheckAcceptedFriendMessageAccessHandler({ firestore, HttpsError });

        await expect(handler(
            { recipientId: 'user:owner-1', teamId: 'team-1' },
            { auth: { uid: 'parent-1', token: { email: 'parent@example.com' } } }
        )).resolves.toEqual({ allowed: true });
        expect(reads).toEqual(expect.arrayContaining([
            'friendships/owner-1__parent-1',
            'teams/team-1',
            'users/parent-1',
            'users/owner-1'
        ]));
        await expect(handler({}, {})).rejects.toMatchObject({ code: 'unauthenticated' });
    });
});
