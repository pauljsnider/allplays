import { describe, expect, it } from 'vitest';
import {
    MAX_HIGHLIGHT_CLIP_MS,
    buildHighlightShareUrl,
    createHighlightClipDraft,
    normalizeSavedHighlightClips,
    resolveReplayVideoOptions
} from '../../js/live-game-video.js';

describe('live game replay video helpers', () => {
    it('prefers archived replay video for completed replay games', () => {
        const options = resolveReplayVideoOptions({
            team: {
                twitchChannel: 'allplayslive'
            },
            game: {
                liveStatus: 'completed',
                replayVideo: {
                    url: 'https://cdn.example.com/games/game-1.mp4',
                    publicUrl: 'https://video.example.com/game-1',
                    posterUrl: 'https://cdn.example.com/games/game-1.jpg',
                    durationMs: 180_000
                }
            },
            isReplay: true
        });

        expect(options.mode).toBe('recorded');
        expect(options.hasVideo).toBe(true);
        expect(options.sourceUrl).toBe('https://cdn.example.com/games/game-1.mp4');
        expect(options.publicUrl).toBe('https://video.example.com/game-1');
        expect(options.posterUrl).toBe('https://cdn.example.com/games/game-1.jpg');
    });

    it('clamps new highlight clips to 60 seconds and the source duration', () => {
        const clip = createHighlightClipDraft({
            startMs: 25_000,
            endMs: 120_000,
            durationMs: 70_000,
            title: 'Fast break'
        });

        expect(clip.startMs).toBe(25_000);
        expect(clip.endMs).toBe(70_000);
        expect(clip.endMs - clip.startMs).toBeLessThanOrEqual(MAX_HIGHLIGHT_CLIP_MS);
        expect(clip.title).toBe('Fast break');
    });

    it('normalizes saved highlight clips and drops invalid ranges', () => {
        const clips = normalizeSavedHighlightClips({
            highlightClips: [
                { title: 'Layup', startMs: 5_000, endMs: 55_000 },
                { title: 'Too long', startMs: 0, endMs: 120_000 },
                { title: 'Backwards', startMs: 20_000, endMs: 10_000 }
            ]
        }, {
            durationMs: 90_000
        });

        expect(clips).toEqual([
            { title: 'Layup', startMs: 5_000, endMs: 55_000 },
            { title: 'Too long', startMs: 0, endMs: 60_000 }
        ]);
    });

    it('builds replay clip links with bounded start and end params', () => {
        const url = buildHighlightShareUrl({
            origin: 'https://allplays.example',
            teamId: 'team-1',
            gameId: 'game-1',
            startMs: 12_000,
            endMs: 72_000
        });

        expect(url).toBe('https://allplays.example/live-game.html?teamId=team-1&gameId=game-1&replay=true&clipStart=12000&clipEnd=72000');
    });
});
