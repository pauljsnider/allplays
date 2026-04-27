import { describe, expect, it } from 'vitest';
import {
    MAX_HIGHLIGHT_CLIP_MS,
    buildHighlightShareUrl,
    createHighlightClipDraft,
    normalizeSavedHighlightClips,
    resolveReplayVideoOptions,
    shouldReloadVideoPlayback
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

    it('normalizes attached scored play clips for the video tab', () => {
        const clips = normalizeSavedHighlightClips({
            highlightClips: [
                {
                    id: 'clip-1',
                    type: 'score-linked',
                    title: 'Corner three',
                    caption: 'Big shot',
                    mediaUrl: 'https://cdn.example.com/clip.mp4',
                    playEventId: 'event-1',
                    selectedPlayerIds: ['player-1'],
                    scoreContext: { homeScore: 21, awayScore: 18 }
                }
            ]
        });

        expect(clips).toEqual([
            expect.objectContaining({
                id: 'clip-1',
                type: 'score-linked',
                title: 'Corner three',
                mediaUrl: 'https://cdn.example.com/clip.mp4',
                playEventId: 'event-1',
                selectedPlayerIds: ['player-1'],
                scoreContext: { homeScore: 21, awayScore: 18 }
            })
        ]);
    });

    it('shows attached clips as video playback when no replay video exists', () => {
        const options = resolveReplayVideoOptions({
            team: {},
            game: {
                highlightClips: [
                    {
                        type: 'score-linked',
                        title: 'Putback',
                        mediaUrl: 'https://cdn.example.com/putback.mp4'
                    }
                ]
            },
            isReplay: false
        });

        expect(options.mode).toBe('recorded');
        expect(options.hasVideo).toBe(true);
        expect(options.sourceUrl).toBe('https://cdn.example.com/putback.mp4');
        expect(options.savedHighlights).toHaveLength(1);
    });

    it('keeps the live embed visible over attached clips while a game is active', () => {
        const options = resolveReplayVideoOptions({
            team: {
                youtubeVideoId: 'dQw4w9WgXcQ'
            },
            game: {
                liveStatus: 'live',
                highlightClips: [
                    {
                        type: 'score-linked',
                        title: 'Putback',
                        mediaUrl: 'https://cdn.example.com/putback.mp4'
                    }
                ]
            },
            isReplay: false
        });

        expect(options.mode).toBe('embed');
        expect(options.hasVideo).toBe(true);
        expect(options.sourceUrl).toContain('youtube.com/embed/dQw4w9WgXcQ');
        expect(options.savedHighlights).toHaveLength(1);
    });

    it('keeps the live embed visible during active replay links with attached clips', () => {
        const options = resolveReplayVideoOptions({
            team: {
                youtubeVideoId: 'dQw4w9WgXcQ'
            },
            game: {
                liveStatus: 'live',
                replayVideo: {
                    url: 'https://cdn.example.com/games/game-1.mp4',
                    durationMs: 180_000
                },
                highlightClips: [
                    {
                        type: 'score-linked',
                        title: 'Putback',
                        mediaUrl: 'https://cdn.example.com/putback.mp4'
                    }
                ]
            },
            isReplay: true,
            clipStartMs: 10_000,
            clipEndMs: 25_000
        });

        expect(options.mode).toBe('embed');
        expect(options.hasVideo).toBe(true);
        expect(options.sourceUrl).toContain('youtube.com/embed/dQw4w9WgXcQ');
        expect(options.clipStartMs).toBeNull();
        expect(options.clipEndMs).toBeNull();
        expect(options.savedHighlights).toHaveLength(1);
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

    it('keeps embedded playback running when the source is unchanged', () => {
        expect(shouldReloadVideoPlayback(
            { mode: 'embed', sourceUrl: 'https://www.youtube.com/embed/live123?autoplay=1&mute=1' },
            { mode: 'embed', sourceUrl: 'https://www.youtube.com/embed/live123?autoplay=1&mute=1' }
        )).toBe(false);
    });

    it('keeps recorded playback running when the source is unchanged', () => {
        expect(shouldReloadVideoPlayback(
            { mode: 'recorded', sourceUrl: 'https://cdn.example.com/game.mp4' },
            { mode: 'recorded', sourceUrl: 'https://cdn.example.com/game.mp4', posterUrl: 'https://cdn.example.com/game.jpg' }
        )).toBe(false);
    });

    it('reloads playback when the mode or source changes', () => {
        expect(shouldReloadVideoPlayback(
            { mode: 'embed', sourceUrl: 'https://www.youtube.com/embed/live123?autoplay=1&mute=1' },
            { mode: 'recorded', sourceUrl: 'https://cdn.example.com/game.mp4' }
        )).toBe(true);

        expect(shouldReloadVideoPlayback(
            { mode: 'embed', sourceUrl: 'https://www.youtube.com/embed/live123?autoplay=1&mute=1' },
            { mode: 'embed', sourceUrl: 'https://www.youtube.com/embed/live456?autoplay=1&mute=1' }
        )).toBe(true);
    });
});
