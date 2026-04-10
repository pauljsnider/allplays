import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cancelScheduledGame } from '../../js/edit-schedule-cancel-game.js';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('cancelScheduledGame', () => {
    it('wires edit schedule through the shared cancellation helper', () => {
        const source = readEditSchedule();

        expect(source).toContain("import { cancelScheduledGame } from './js/edit-schedule-cancel-game.js?v=1';");
        expect(source).toContain('const result = await cancelScheduledGame({');
        expect(source).toContain('await loadSchedule();');
        expect(source).toContain('Game cancelled, but team chat notification failed:');
        expect(source).not.toContain("alert('Error cancelling game: ' + err.message);");
    });

    it('keeps the cancellation successful when the follow-up chat notification fails', async () => {
        const cancelGame = vi.fn().mockResolvedValue(undefined);
        const postChatMessage = vi.fn().mockRejectedValue(new Error('chat writes blocked'));

        const result = await cancelScheduledGame({
            teamId: 'team-123',
            gameId: 'game-456',
            user: {
                uid: 'user-789',
                displayName: 'Coach Kelly',
                email: 'coach@example.com'
            },
            game: {
                opponent: 'Tigers',
                date: '2026-03-10T18:00:00.000Z'
            },
            cancelGame,
            postChatMessage
        });

        expect(cancelGame).toHaveBeenCalledWith('team-123', 'game-456', 'user-789');
        expect(postChatMessage).toHaveBeenCalledWith('team-123', {
            text: '⚠️ Game cancelled: vs. Tigers on Tue, Mar 10',
            senderId: 'user-789',
            senderName: 'Coach Kelly',
            senderEmail: 'coach@example.com'
        });
        expect(result).toEqual({
            cancelled: true,
            notificationError: 'chat writes blocked'
        });
    });

    it('returns a fatal error when the cancellation write itself fails', async () => {
        const cancelGame = vi.fn().mockRejectedValue(new Error('permission denied'));
        const postChatMessage = vi.fn();

        const result = await cancelScheduledGame({
            teamId: 'team-123',
            gameId: 'game-456',
            user: {
                uid: 'user-789',
                displayName: 'Coach Kelly',
                email: 'coach@example.com'
            },
            game: {
                opponent: 'Tigers',
                date: '2026-03-10T18:00:00.000Z'
            },
            cancelGame,
            postChatMessage
        });

        expect(postChatMessage).not.toHaveBeenCalled();
        expect(result).toEqual({
            cancelled: false,
            error: 'permission denied'
        });
    });
});
