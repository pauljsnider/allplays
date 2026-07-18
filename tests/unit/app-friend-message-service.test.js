import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    functions: { app: 'test' },
    callable: vi.fn(),
    httpsCallable: vi.fn()
}));

vi.mock('../../apps/app/src/lib/adapters/legacyFriendMessage.ts', () => firebaseMocks);

const user = {
    uid: 'user-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent'
};

beforeEach(() => {
    vi.clearAllMocks();
    firebaseMocks.callable.mockResolvedValue({ data: { allowed: false } });
    firebaseMocks.httpsCallable.mockReturnValue(firebaseMocks.callable);
});

describe('friend direct-message authorization', () => {
    it('allows a connection only when the server verifies current friend and team access', async () => {
        firebaseMocks.callable.mockResolvedValue({ data: { allowed: true } });
        const { canMessageAcceptedFriend } = await import('../../apps/app/src/lib/friendMessageService.ts');

        await expect(canMessageAcceptedFriend(user, 'user:friend-1', 'team-1')).resolves.toBe(true);
        expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith(
            firebaseMocks.functions,
            'checkAcceptedFriendMessageAccess'
        );
        expect(firebaseMocks.callable).toHaveBeenCalledWith({
            recipientId: 'friend-1',
            teamId: 'team-1'
        });
    });

    it('denies when the server cannot verify current access', async () => {
        const { canMessageAcceptedFriend } = await import('../../apps/app/src/lib/friendMessageService.ts');

        await expect(canMessageAcceptedFriend(user, 'friend-1', 'team-1')).resolves.toBe(false);
    });

    it('rejects malformed and self-recipient routes without calling the server', async () => {
        const { canMessageAcceptedFriend } = await import('../../apps/app/src/lib/friendMessageService.ts');

        await expect(canMessageAcceptedFriend(user, '../friend', 'team-1')).resolves.toBe(false);
        await expect(canMessageAcceptedFriend(user, 'user-1', 'team-1')).resolves.toBe(false);
        expect(firebaseMocks.callable).not.toHaveBeenCalled();
    });

    it('propagates server verification failures so callers fail closed with feedback', async () => {
        firebaseMocks.callable.mockRejectedValue(new Error('Permission denied.'));
        const { canMessageAcceptedFriend } = await import('../../apps/app/src/lib/friendMessageService.ts');

        await expect(canMessageAcceptedFriend(user, 'friend-1', 'team-1')).rejects.toThrow('Permission denied.');
    });
});
