import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readPlayerPage() {
    return readFileSync(new URL('../../player.html', import.meta.url), 'utf8');
}

function buildVideoClipHelpers() {
    const source = readPlayerPage();
    const start = source.indexOf('function cleanClipString(');
    const end = source.indexOf('function renderClipPlayableMedia(');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const factory = new Function(`
        ${source.slice(start, end)}
        return { collectPlayerVideoClips, normalizePlayerVideoClip };
    `);

    return factory();
}

describe('player video clips tab', () => {
    it('wires Video Clips alongside the existing player profile tabs', () => {
        const html = readPlayerPage();

        expect(html).toContain('id="tab-games"');
        expect(html).toContain('id="tab-season"');
        expect(html).toContain('id="tab-events"');
        expect(html).toContain('id="tab-video-clips"');
        expect(html).toContain('id="content-video-clips"');
        expect(html).toContain("const tabs = ['games', 'season', 'events', 'video-clips'];");
    });

    it('renders a clear empty state before generated clips exist', () => {
        const html = readPlayerPage();

        expect(html).toContain('No video clips yet');
        expect(html).toContain('Player clips will appear here after scored streamed games are processed.');
    });

    it('collects player and game clip metadata for the selected player only', () => {
        const { collectPlayerVideoClips } = buildVideoClipHelpers();
        const player = {
            videoClips: [
                {
                    title: 'Baseline drive',
                    url: 'https://cdn.example.com/baseline.mp4',
                    thumbnailUrl: 'https://cdn.example.com/baseline.jpg',
                    gameDate: '2026-02-01',
                    playLabel: 'Layup'
                }
            ]
        };
        const games = [
            {
                id: 'game-1',
                date: '2026-02-10',
                videoClips: [
                    {
                        playerId: 'player-1',
                        title: 'Steal and score',
                        videoUrl: 'https://cdn.example.com/steal.mp4',
                        posterUrl: 'https://cdn.example.com/steal.jpg',
                        label: 'Steal'
                    },
                    {
                        playerId: 'other-player',
                        title: 'Other player clip',
                        url: 'https://cdn.example.com/other.mp4'
                    }
                ]
            }
        ];

        const clips = collectPlayerVideoClips(player, games, 'player-1');

        expect(clips).toHaveLength(2);
        expect(clips.map((clip) => clip.title)).toEqual(['Steal and score', 'Baseline drive']);
        expect(clips[0]).toMatchObject({
            url: 'https://cdn.example.com/steal.mp4',
            thumbnailUrl: 'https://cdn.example.com/steal.jpg',
            playLabel: 'Steal',
            mediaType: 'video',
            gameId: 'game-1'
        });
    });
});
