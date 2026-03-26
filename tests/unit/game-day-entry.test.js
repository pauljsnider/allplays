import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    pickBestGameId,
    normalizeGameDayUrl
} from '../../js/game-day-entry.js';

function at(isoString) {
    return new Date(isoString);
}

describe('game day entry routing', () => {
    it('prefers the live game from a mixed schedule and normalizes the URL', () => {
        const now = at('2026-03-26T20:25:00Z');
        const games = [
            { id: 'practice-1', type: 'practice', date: at('2026-03-26T19:30:00Z') },
            { id: 'completed-1', type: 'game', status: 'completed', liveStatus: 'completed', date: at('2026-03-25T20:00:00Z') },
            { id: 'future-1', type: 'game', status: 'scheduled', date: at('2026-03-26T21:30:00Z') },
            { id: 'live-1', type: 'game', status: 'scheduled', liveStatus: 'live', date: at('2026-03-26T20:00:00Z') }
        ];

        expect(pickBestGameId(games, null, now)).toBe('live-1');

        const replaceState = vi.fn();
        normalizeGameDayUrl('team-7', 'live-1', {
            location: { pathname: '/team.html', search: '?teamId=team-7' },
            history: { replaceState }
        });

        expect(replaceState).toHaveBeenCalledWith(
            {},
            '',
            'game-day.html?teamId=team-7&gameId=live-1'
        );
    });

    it('ignores a stale requested id and falls back to the nearest valid upcoming game', () => {
        const now = at('2026-03-26T20:25:00Z');
        const games = [
            { id: 'stale-completed', type: 'game', status: 'completed', liveStatus: 'completed', date: at('2026-03-25T18:00:00Z') },
            { id: 'cancelled-1', type: 'game', status: 'cancelled', date: at('2026-03-26T20:45:00Z') },
            { id: 'soon-1', type: 'game', status: 'scheduled', date: at('2026-03-26T21:00:00Z') },
            { id: 'recent-1', type: 'game', status: 'scheduled', date: at('2026-03-26T15:00:00Z') }
        ];

        expect(pickBestGameId(games, 'stale-completed', now)).toBe('soon-1');
    });
});

describe('game day entry page wiring', () => {
    it('routes selection and normalization through the shared helper before loading the resolved game', () => {
        const source = readFileSync(resolve(process.cwd(), 'game-day.html'), 'utf8');

        expect(source).toContain("from './js/game-day-entry.js?v=1'");
        expect(source).toContain('const resolvedGameId = pickBestGameId(games, gameId);');
        expect(source).toContain('normalizeGameDayUrl(teamId, resolvedGameId);');
        expect(source).toContain('const game = await getGame(teamId, resolvedGameId);');
    });
});
