import { describe, expect, it } from 'vitest';
import {
    MAX_HIGHLIGHT_CLIP_MS,
    buildHighlightShareUrl,
    createHighlightClipDraft,
    normalizeGameClipRecords,
    normalizeGameRecapHighlightClips,
    normalizeSavedHighlightClips,
    canAccessNativeCameraCapture,
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

        expect(clips).toMatchObject([
            { title: 'Layup', startMs: 5_000, endMs: 55_000, description: 'Layup' },
            { title: 'Too long', startMs: 0, endMs: 60_000, description: 'Too long' }
        ]);
    });

    it('normalizes game recap clip metadata with context players and links', () => {
        const clips = normalizeGameRecapHighlightClips({
            replayVideo: {
                url: 'https://cdn.example.com/full-game.mp4',
                publicUrl: 'https://video.example.com/full-game'
            },
            clipMetadata: [
                {
                    order: 2,
                    playDescription: 'Riley hits the go-ahead three',
                    period: 'Q4',
                    gameTime: '0:42',
                    playerIds: ['p1'],
                    videoUrl: 'https://video.example.com/clip-2'
                },
                {
                    order: 1,
                    title: 'Opening run',
                    startMs: 10_000,
                    endMs: 35_000,
                    players: [{ id: 'p2', name: 'Jordan', number: '12' }]
                }
            ]
        });

        expect(clips).toMatchObject([
            {
                title: 'Opening run',
                startMs: 10_000,
                endMs: 35_000,
                videoUrl: 'https://video.example.com/full-game',
                players: [{ id: 'p2', name: 'Jordan', number: '12' }]
            },
            {
                title: 'Riley hits the go-ahead three',
                description: 'Riley hits the go-ahead three',
                startMs: null,
                endMs: null,
                period: 'Q4',
                gameTime: '0:42',
                videoUrl: 'https://video.example.com/clip-2',
                players: [{ id: 'p1', name: 'p1' }]
            }
        ]);
    });

    it('preserves normalized player tags on saved highlights', () => {
        const clip = createHighlightClipDraft({
            title: 'Drive and dish',
            startMs: 10_000,
            endMs: 35_000,
            taggedPlayerIds: [' player-1 ', 'player-2', 'player-1', '', null]
        });

        expect(clip).toEqual({
            title: 'Drive and dish',
            startMs: 10_000,
            endMs: 35_000,
            taggedPlayerIds: ['player-1', 'player-2']
        });

        const clips = normalizeSavedHighlightClips({
            highlightClips: [
                { title: 'Assist', startMs: 12_000, endMs: 42_000, taggedPlayerIds: ['player-3'] },
                { title: 'Untagged', startMs: 45_000, endMs: 55_000 }
            ]
        });

        expect(clips).toMatchObject([
            { title: 'Assist', startMs: 12_000, endMs: 42_000, taggedPlayerIds: ['player-3'] },
            { title: 'Untagged', startMs: 45_000, endMs: 55_000 }
        ]);
    });

    it('preserves null timing for untimed recap clips that use the replay fallback', () => {
        const clips = normalizeGameRecapHighlightClips({
            replayVideo: {
                url: 'https://cdn.example.com/full-game.mp4',
                publicUrl: 'https://video.example.com/full-game'
            },
            clipMetadata: [
                {
                    playDescription: 'Post-game note with no timestamp'
                }
            ]
        });

        expect(clips).toMatchObject([
            {
                title: 'Post-game note with no timestamp',
                startMs: null,
                endMs: null,
                videoUrl: 'https://video.example.com/full-game'
            }
        ]);
    });

    it('normalizes score-linked game clip records for playable cards', () => {
        const clips = normalizeGameClipRecords({
            clips: [
                {
                    id: 'clip-1',
                    title: 'Go-ahead three',
                    videoUrl: 'https://cdn.example.com/clip-1.mp4',
                    playDescription: 'Mia hits from the corner',
                    scoreContext: 'Home 42, Away 40',
                    period: 'Q4',
                    playerIds: ['p1']
                },
                {
                    id: 'hidden-clip',
                    url: 'https://cdn.example.com/hidden.mp4',
                    hidden: true
                },
                {
                    id: 'unsafe-clip',
                    url: 'javascript:alert(1)'
                }
            ]
        }, {
            players: [{ id: 'p1', name: 'Mia Chen', number: '12' }]
        });

        expect(clips).toHaveLength(1);
        expect(clips[0]).toMatchObject({
            id: 'clip-1',
            title: 'Go-ahead three',
            playDescription: 'Mia hits from the corner',
            scoreContext: 'Home 42, Away 40',
            period: 'Q4',
            players: ['#12 Mia Chen'],
            url: 'https://cdn.example.com/clip-1.mp4'
        });
        expect(clips[0].downloadName).toBe('Go_ahead_three.mp4');
    });

    it('exposes the video tab model for games with no stream or clips', () => {
        const options = resolveReplayVideoOptions({
            team: {},
            game: {},
            isReplay: false
        });

        expect(options.mode).toBe('none');
        expect(options.hasVideo).toBe(false);
        expect(options.gameClips).toEqual([]);
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


describe('native camera capture authorization', () => {
    const scheduledGame = { status: 'scheduled' };

    it('allows team owners and admins on scheduled games', () => {
        expect(canAccessNativeCameraCapture({
            user: { uid: 'owner-1', email: 'owner@example.com' },
            team: { ownerId: 'owner-1', adminEmails: [] },
            game: scheduledGame
        })).toBe(true);

        expect(canAccessNativeCameraCapture({
            user: { uid: 'coach-2', email: 'Coach@Example.com' },
            team: { ownerId: 'owner-1', adminEmails: ['coach@example.com'] },
            game: scheduledGame
        })).toBe(true);
    });

    it('allows explicitly approved media contributors by uid or email', () => {
        expect(canAccessNativeCameraCapture({
            user: { uid: 'streamer-1', email: 'helper@example.com' },
            team: { ownerId: 'owner-1', adminEmails: [], mediaContributorUids: ['streamer-1'] },
            game: scheduledGame
        })).toBe(true);

        expect(canAccessNativeCameraCapture({
            user: { uid: 'helper-2', email: 'Helper@Example.com' },
            team: { ownerId: 'owner-1', adminEmails: [] },
            game: { ...scheduledGame, mediaContributorEmails: ['helper@example.com'] }
        })).toBe(true);
    });

    it('blocks regular viewers and ended games', () => {
        expect(canAccessNativeCameraCapture({
            user: { uid: 'viewer-1', email: 'viewer@example.com' },
            team: { ownerId: 'owner-1', adminEmails: [] },
            game: scheduledGame
        })).toBe(false);

        expect(canAccessNativeCameraCapture({
            user: { uid: 'owner-1', email: 'owner@example.com' },
            team: { ownerId: 'owner-1', adminEmails: [] },
            game: { status: 'completed' }
        })).toBe(false);
    });
});
