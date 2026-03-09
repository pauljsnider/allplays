import { describe, it, expect, vi } from 'vitest';
import { runGameCancellationFlow } from '../../js/edit-schedule-cancellation.js';

describe('edit schedule cancellation flow', () => {
    it('preserves cancellation success when chat notification fails', async () => {
        const cancelGame = vi.fn().mockResolvedValue(undefined);
        const postChatMessage = vi.fn().mockRejectedValue(new Error('chat unavailable'));

        const result = await runGameCancellationFlow({
            teamId: 'team-1',
            gameId: 'game-1',
            game: {
                opponent: 'Tigers',
                date: new Date('2026-03-10T18:00:00.000Z')
            },
            currentUser: {
                uid: 'user-1',
                email: 'coach@example.com',
                displayName: 'Coach Carter'
            },
            cancelGame,
            postChatMessage
        });

        expect(cancelGame).toHaveBeenCalledWith('team-1', 'game-1', 'user-1');
        expect(postChatMessage).toHaveBeenCalledWith('team-1', {
            text: '⚠️ Game cancelled: vs. Tigers on Tue, Mar 10',
            senderId: 'user-1',
            senderName: 'Coach Carter',
            senderEmail: 'coach@example.com'
        });
        expect(result).toMatchObject({
            cancellationSucceeded: true,
            notificationSucceeded: false
        });
        expect(result.notificationError).toBeInstanceOf(Error);
        expect(result.notificationError.message).toBe('chat unavailable');
    });

    it('fails the flow when the cancellation write fails', async () => {
        const cancelGame = vi.fn().mockRejectedValue(new Error('permission denied'));
        const postChatMessage = vi.fn();

        await expect(runGameCancellationFlow({
            teamId: 'team-1',
            gameId: 'game-1',
            game: {
                opponent: 'Tigers',
                date: new Date('2026-03-10T18:00:00.000Z')
            },
            currentUser: {
                uid: 'user-1',
                email: 'coach@example.com'
            },
            cancelGame,
            postChatMessage
        })).rejects.toThrow('permission denied');

        expect(postChatMessage).not.toHaveBeenCalled();
    });
});
