import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    db: { app: 'test' },
    doc: vi.fn((db, ...path) => ({ db, path })),
    getDoc: vi.fn()
}));

vi.mock('../../apps/app/src/lib/adapters/legacySocialDb.ts', () => firebaseMocks);

const user = {
    uid: 'user-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent'
};

function friendshipSnapshot(data) {
    return {
        exists: () => true,
        data: () => data
    };
}

function missingSnapshot() {
    return { exists: () => false };
}

beforeEach(() => {
    vi.clearAllMocks();
    firebaseMocks.getDoc.mockResolvedValue(missingSnapshot());
});

describe('friend direct-message authorization', () => {
    it('allows an accepted friendship that includes both users and the requested shared team', async () => {
        firebaseMocks.getDoc.mockImplementation(async (reference) => {
            if (reference.path[0] === 'friendships') {
                return friendshipSnapshot({
                    status: 'accepted',
                    memberIds: ['friend-1', 'user-1'],
                    sharedTeamIds: ['team-1', 'team-2']
                });
            }
            if (reference.path[0] === 'publicUserProfiles') {
                return friendshipSnapshot({ discoveryTeamIds: ['team-1'] });
            }
            return missingSnapshot();
        });
        const { canMessageAcceptedFriend } = await import('../../apps/app/src/lib/friendMessageService.ts');

        await expect(canMessageAcceptedFriend(user, 'user:friend-1', 'team-1')).resolves.toBe(true);
        expect(firebaseMocks.doc).toHaveBeenCalledWith(firebaseMocks.db, 'friendships', 'friend-1__user-1');
        expect(firebaseMocks.getDoc).toHaveBeenCalledWith({
            db: firebaseMocks.db,
            path: ['friendships', 'friend-1__user-1']
        });
        expect(firebaseMocks.getDoc).toHaveBeenCalledWith({
            db: firebaseMocks.db,
            path: ['publicUserProfiles', 'friend-1']
        });
        expect(firebaseMocks.getDoc).toHaveBeenCalledWith({
            db: firebaseMocks.db,
            path: ['teams', 'team-1']
        });
    });

    it.each([
        ['a missing friendship', null],
        ['a pending friendship', { status: 'pending', memberIds: ['user-1', 'friend-1'], sharedTeamIds: ['team-1'] }],
        ['unexpected members', { status: 'accepted', memberIds: ['user-1', 'someone-else'], sharedTeamIds: ['team-1'] }],
        ['no requested shared team', { status: 'accepted', memberIds: ['user-1', 'friend-1'], sharedTeamIds: ['team-2'] }]
    ])('denies %s', async (_label, friendship) => {
        if (friendship) {
            firebaseMocks.getDoc.mockImplementation(async (reference) => reference.path[0] === 'friendships'
                ? friendshipSnapshot(friendship)
                : missingSnapshot());
        }
        const { canMessageAcceptedFriend } = await import('../../apps/app/src/lib/friendMessageService.ts');

        await expect(canMessageAcceptedFriend(user, 'friend-1', 'team-1')).resolves.toBe(false);
    });

    it('denies a stale shared-team friendship when the recipient no longer has current team access', async () => {
        firebaseMocks.getDoc.mockImplementation(async (reference) => reference.path[0] === 'friendships'
            ? friendshipSnapshot({
                status: 'accepted',
                memberIds: ['user-1', 'friend-1'],
                sharedTeamIds: ['team-1']
            })
            : missingSnapshot());
        const { canMessageAcceptedFriend } = await import('../../apps/app/src/lib/friendMessageService.ts');

        await expect(canMessageAcceptedFriend(user, 'friend-1', 'team-1')).resolves.toBe(false);
    });

    it('accepts current membership from the team chat member projection', async () => {
        firebaseMocks.getDoc.mockImplementation(async (reference) => {
            if (reference.path[0] === 'friendships') {
                return friendshipSnapshot({
                    status: 'accepted',
                    memberIds: ['user-1', 'friend-1'],
                    sharedTeamIds: ['team-1']
                });
            }
            if (reference.path[0] === 'teams') {
                return friendshipSnapshot({ chatMemberIds: ['user:friend-1'] });
            }
            return missingSnapshot();
        });
        const { canMessageAcceptedFriend } = await import('../../apps/app/src/lib/friendMessageService.ts');

        await expect(canMessageAcceptedFriend(user, 'friend-1', 'team-1')).resolves.toBe(true);
    });

    it('propagates friendship lookup failures so callers fail closed with feedback', async () => {
        firebaseMocks.getDoc.mockImplementation(async (reference) => {
            if (reference.path[0] === 'friendships') throw new Error('Permission denied.');
            return missingSnapshot();
        });
        const { canMessageAcceptedFriend } = await import('../../apps/app/src/lib/friendMessageService.ts');

        await expect(canMessageAcceptedFriend(user, 'friend-1', 'team-1')).rejects.toThrow('Permission denied.');
    });
});
