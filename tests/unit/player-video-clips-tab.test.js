import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectPlayerVideoClips } from '../../js/player-profile-stats.js';

function readPlayerPage() {
    return readFileSync(new URL('../../player.html', import.meta.url), 'utf8');
}

describe('player video clips tab', () => {
    it('wires Video Clips into the existing player profile tab navigation', () => {
        const html = readPlayerPage();

        expect(html).toContain('id="tab-clips"');
        expect(html).toContain('Video Clips');
        expect(html).toContain('id="content-clips"');
        expect(html).toContain("const tabs = ['games', 'season', 'events', 'clips'];");
    });

    it('renders an empty state for clips without changing existing tab content', () => {
        const html = readPlayerPage();

        expect(html).toContain('No video clips yet');
        expect(html).toContain('Player clips will appear here after scored streamed games are processed.');
        expect(html).toContain('id="content-games"');
        expect(html).toContain('id="content-season"');
        expect(html).toContain('id="content-events"');
    });

    it('collects only playable player video clips from existing game metadata', () => {
        const clips = collectPlayerVideoClips([
            {
                id: 'game-1',
                opponentName: 'Tigers',
                date: '2026-04-25',
                replayVideo: {
                    url: 'https://cdn.example.com/replay.mp4',
                    posterUrl: 'https://cdn.example.com/poster.jpg',
                    highlights: [
                        { id: 'clip-1', playerIds: ['player-1'], title: 'Fast break', playDescription: 'Layup', startMs: 1000, endMs: 9000 },
                        { id: 'clip-2', playerIds: ['player-1'], title: 'Bad range' },
                        { id: 'clip-3', playerIds: ['player-2'], title: 'Other player', startMs: 0, endMs: 5000 }
                    ]
                },
                gameClips: [
                    { id: 'clip-4', playerId: 'player-1', title: 'Corner three', videoUrl: 'https://video.example.com/clip-4.mp4', thumbnailUrl: 'https://video.example.com/thumb.jpg' },
                    { id: 'clip-5', playerId: 'player-1', title: 'Unsafe', videoUrl: 'javascript:alert(1)' }
                ]
            }
        ], { teamId: 'team-1', playerId: 'player-1' });

        expect(clips).toEqual([
            {
                id: 'clip-4',
                title: 'Corner three',
                gameDate: '4/25/2026',
                playLabel: 'Highlight',
                url: 'https://video.example.com/clip-4.mp4',
                thumbnailUrl: 'https://video.example.com/thumb.jpg',
                gameLabel: 'Tigers'
            },
            {
                id: 'clip-1',
                title: 'Fast break',
                gameDate: '4/25/2026',
                playLabel: 'Layup',
                url: 'live-game.html?teamId=team-1&gameId=game-1&replay=true&clipStart=1000&clipEnd=9000',
                thumbnailUrl: 'https://cdn.example.com/poster.jpg',
                gameLabel: 'Tigers'
            }
        ]);
    });
});
