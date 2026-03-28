import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

function extractCancelGameHandlerBody() {
    const source = readEditSchedule();
    const match = source.match(/document\.querySelectorAll\('\.cancel-game-btn'\)\.forEach\(btn => \{\s*btn\.addEventListener\('click', async \(e\) => \{([\s\S]*?)\n\s*\}\);\s*\}\);/);
    expect(match, 'cancel game click handler should exist').toBeTruthy();
    return match[1];
}

function buildCancelGameHandler(overrides = {}) {
    const body = extractCancelGameHandlerBody();
    const deps = {
        gamesCache: {
            game123: {
                opponent: 'Tigers',
                date: new Date('2026-03-09T18:00:00Z')
            }
        },
        currentTeamId: 'team-1',
        currentUser: {
            uid: 'user-1',
            displayName: 'Coach Carter',
            email: 'coach@example.com'
        },
        confirm: vi.fn(() => true),
        cancelGame: vi.fn(() => Promise.resolve()),
        cancelScheduledGame: vi.fn(() => Promise.resolve({ cancelled: true, notificationError: null })),
        postChatMessage: vi.fn(() => Promise.resolve()),
        getTeamScheduleNotificationSettings: vi.fn(() => ({ enabled: true, reminderHours: 24 })),
        buildScheduleNotificationMetadata: vi.fn(() => ({ sent: true })),
        updateGame: vi.fn(() => Promise.resolve()),
        loadSchedule: vi.fn(),
        console: { error: vi.fn() },
        alert: vi.fn(),
        ...overrides
    };

    const createHandler = new Function('deps', `
        const { gamesCache, currentTeamId, currentUser, confirm, cancelGame, cancelScheduledGame, postChatMessage, getTeamScheduleNotificationSettings, buildScheduleNotificationMetadata, updateGame, loadSchedule, console, alert } = deps;
        return async function(e) {
${body}
        };
    `);

    return { deps, handler: createHandler(deps) };
}

describe('edit schedule cancel-game handler', () => {
    it('keeps cancellation successful when chat notification posting fails', async () => {
        const notificationError = new Error('chat write failed');
        const { deps, handler } = buildCancelGameHandler({
            cancelScheduledGame: vi.fn(() => Promise.resolve({
                cancelled: true,
                notificationError
            }))
        });

        await handler({ target: { dataset: { gameId: 'game123' } } });

        expect(deps.cancelScheduledGame).toHaveBeenCalledWith(expect.objectContaining({
            teamId: 'team-1',
            gameId: 'game123',
            user: expect.objectContaining({ uid: 'user-1' }),
            game: expect.objectContaining({ opponent: 'Tigers' }),
            cancelGame: deps.cancelGame,
            postChatMessage: deps.postChatMessage
        }));
        expect(deps.buildScheduleNotificationMetadata).toHaveBeenCalledTimes(1);
        expect(deps.updateGame).toHaveBeenCalledTimes(1);
        expect(deps.loadSchedule).toHaveBeenCalledTimes(1);
        expect(deps.alert).toHaveBeenCalledWith('Game cancelled, but team chat notification failed: Error: chat write failed');
    });

    it('still reports cancellation failure when the cancellation write fails', async () => {
        const cancelError = new Error('permission denied');
        const { deps, handler } = buildCancelGameHandler({
            cancelScheduledGame: vi.fn(() => Promise.resolve({
                cancelled: false,
                error: cancelError
            }))
        });

        await handler({ target: { dataset: { gameId: 'game123' } } });

        expect(deps.cancelScheduledGame).toHaveBeenCalledTimes(1);
        expect(deps.updateGame).not.toHaveBeenCalled();
        expect(deps.loadSchedule).not.toHaveBeenCalled();
        expect(deps.alert).toHaveBeenCalledWith('Error cancelling game: Error: permission denied');
    });
});
