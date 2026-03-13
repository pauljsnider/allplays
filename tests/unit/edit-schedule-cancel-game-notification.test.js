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
        postChatMessage: vi.fn(() => Promise.resolve()),
        loadSchedule: vi.fn(),
        console: { error: vi.fn() },
        alert: vi.fn(),
        ...overrides
    };

    const createHandler = new Function('deps', `
        const { gamesCache, currentTeamId, currentUser, confirm, cancelGame, postChatMessage, loadSchedule, console, alert } = deps;
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
            postChatMessage: vi.fn(() => Promise.reject(notificationError))
        });

        await handler({ target: { dataset: { gameId: 'game123' } } });

        expect(deps.cancelGame).toHaveBeenCalledWith('team-1', 'game123', 'user-1');
        expect(deps.postChatMessage).toHaveBeenCalledTimes(1);
        expect(deps.loadSchedule).toHaveBeenCalledTimes(1);
        expect(deps.alert).toHaveBeenCalledWith('Game cancelled, but the team chat notification could not be sent: chat write failed');
    });

    it('still reports cancellation failure when the cancellation write fails', async () => {
        const cancelError = new Error('permission denied');
        const { deps, handler } = buildCancelGameHandler({
            cancelGame: vi.fn(() => Promise.reject(cancelError))
        });

        await handler({ target: { dataset: { gameId: 'game123' } } });

        expect(deps.cancelGame).toHaveBeenCalledTimes(1);
        expect(deps.postChatMessage).not.toHaveBeenCalled();
        expect(deps.loadSchedule).not.toHaveBeenCalled();
        expect(deps.alert).toHaveBeenCalledWith('Error cancelling game: permission denied');
    });
});
