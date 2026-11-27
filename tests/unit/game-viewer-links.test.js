import { describe, expect, it } from 'vitest';
import { upgradeGameViewerUrl } from '../../js/game-viewer-links.js';

describe('new navigation from saved viewer links', () => {
    it.each(['live-game.html', '/live-game.html', 'https://allplays.ai/live-game.html'])('upgrades %s while preserving identifiers and highlight timestamps', (base) => {
        const upgraded = upgradeGameViewerUrl(`${base}#teamId=t&gameId=g&replay=true&clipStart=2000&clipEnd=4000`);
        const url = new URL(upgraded, 'https://allplays.ai');
        expect(url.pathname).toBe('/live-game-overlay.html');
        expect([...url.searchParams]).toEqual([['teamId', 't'], ['gameId', 'g'], ['replay', 'true'], ['clipStart', '2000'], ['clipEnd', '4000']]);
    });
    it('marks newly rendered watch shares for the overlay', () => {
        expect(upgradeGameViewerUrl('https://share.allplays.ai/watch?teamId=t&gameId=g'))
            .toBe('https://share.allplays.ai/watch?teamId=t&gameId=g&overlay=true');
    });
    it.each([
        'https://video.example/clip.mp4', 'https://example.com/live-game.html?teamId=t',
        'https://allplays.ai/game.html#teamId=t', 'live-game.html#teamId=t&broadcast=setup',
        'javascript:alert(1)', null
    ])('leaves provider files, unrelated pages, and unused broadcast setup unchanged: %s', (value) => {
        expect(upgradeGameViewerUrl(value)).toBe(value);
    });
});

describe('saved highlight navigation', () => {
    it('upgrades saved links when generating player and report cards without changing stored data', async () => {
        const { collectPlayerVideoClips } = await import('../../js/player-profile-stats.js');
        const { normalizeGameRecapHighlightClips } = await import('../../js/live-game-video.js');
        const oldUrl = 'https://allplays.ai/live-game.html?teamId=t&gameId=g&replay=true&clipStart=2000&clipEnd=4000';
        const game = { id: 'g', videoUrl: 'https://video.example/replay.mp4', highlightClips: [{ title: 'Goal', videoUrl: oldUrl, playerIds: ['p'] }] };
        const playerClip = collectPlayerVideoClips([game], { teamId: 't', playerId: 'p' })[0];
        const reportClip = normalizeGameRecapHighlightClips(game)[0];
        expect(playerClip.url).toContain('/live-game-overlay.html?');
        expect(reportClip.videoUrl).toContain('/live-game-overlay.html?');
        expect(game.highlightClips[0].videoUrl).toBe(oldUrl);
    });
});
