import { describe, expect, it } from 'vitest';
import {
    BROADCAST_SETUP_STATUSES,
    BROADCAST_STREAM_STATUSES,
    BROADCAST_PROVIDER_TYPES,
    MAX_HIGHLIGHT_CLIP_MS,
    buildBroadcastSetupSession,
    buildHighlightShareUrl,
    buildStreamScoreContext,
    createHighlightClipDraft,
    normalizeGameClipRecords,
    normalizeGameRecapHighlightClips,
    normalizeSavedHighlightClips,
    canAccessNativeCameraCapture,
    canSaveBroadcastSetupSession,
    resolveBroadcastProviderMetadata,
    resolveBroadcastStreamControlState,
    resolveGameMediaHub,
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

    it('collects live stream, replay, and saved highlights for the media hub', () => {
        const hub = resolveGameMediaHub({
            team: {
                streamEmbedUrl: 'https://www.youtube.com/embed/abcdefghijk'
            },
            game: {
                replayVideo: {
                    url: 'https://cdn.example.com/game.mp4',
                    publicUrl: 'https://video.example.com/game',
                    title: 'Full replay',
                    durationMs: 120_000
                },
                highlightClips: [
                    { title: 'Big save', startMs: 15_000, endMs: 35_000, videoUrl: 'https://video.example.com/clip' }
                ]
            }
        });

        expect(hub.liveStream).toMatchObject({
            sourceUrl: 'https://www.youtube.com/embed/abcdefghijk?autoplay=1&mute=1',
            publicUrl: 'https://www.youtube.com/watch?v=abcdefghijk'
        });
        expect(hub.replay).toMatchObject({
            sourceUrl: 'https://cdn.example.com/game.mp4',
            publicUrl: 'https://video.example.com/game',
            title: 'Full replay'
        });
        expect(hub.highlights).toMatchObject([
            { title: 'Big save', startMs: 15_000, endMs: 35_000, videoUrl: 'https://video.example.com/clip' }
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
                { title: 'Give and go', startMs: 45_000, endMs: 55_000, selectedPlayerIds: ['player-4'], playEventId: 'event-1' }
            ]
        });

        expect(clips).toMatchObject([
            { title: 'Assist', startMs: 12_000, endMs: 42_000, durationMs: 30_000, taggedPlayerIds: ['player-3'] },
            { title: 'Give and go', startMs: 45_000, endMs: 55_000, durationMs: 10_000, taggedPlayerIds: ['player-4'], playEventId: 'event-1' }
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

    it('keeps saved highlight metadata visible when replay playback is unavailable', () => {
        const options = resolveReplayVideoOptions({
            team: {},
            game: {
                highlightClips: [
                    {
                        title: 'Saved runout',
                        startMs: 8_000,
                        endMs: 28_000,
                        period: 'Q2',
                        gameTime: '4:12',
                        taggedPlayerIds: ['player-8'],
                        description: 'Steal into a layup'
                    }
                ]
            },
            isReplay: false
        });

        expect(options.mode).toBe('none');
        expect(options.hasVideo).toBe(false);
        expect(options.savedHighlights).toMatchObject([
            {
                title: 'Saved runout',
                startMs: 8_000,
                endMs: 28_000,
                durationMs: 20_000,
                period: 'Q2',
                gameTime: '4:12',
                taggedPlayerIds: ['player-8'],
                description: 'Steal into a layup'
            }
        ]);
        expect(options.mediaHub.highlights).toHaveLength(1);
        expect(options.mediaHub.replay).toBeNull();
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
        expect(options.gameClips).toEqual([]);
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

    it('reports a replay unavailable state for completed games without replay video', () => {
        const options = resolveReplayVideoOptions({
            team: {},
            game: {
                liveStatus: 'completed'
            },
            isReplay: true
        });

        expect(options.mode).toBe('none');
        expect(options.hasVideo).toBe(false);
        expect(options.sourceUrl).toBeNull();
        expect(options.replayState).toMatchObject({
            status: 'unavailable',
            title: 'Replay unavailable'
        });
        expect(options.replayState.message).toContain('Coaches, parents, and fans');
    });

    it('blocks playback while replay processing is still pending', () => {
        const options = resolveReplayVideoOptions({
            team: {},
            game: {
                liveStatus: 'completed',
                replayVideo: {
                    status: 'processing',
                    url: 'https://cdn.example.com/not-ready.mp4'
                }
            },
            isReplay: true
        });

        expect(options.mode).toBe('none');
        expect(options.hasVideo).toBe(false);
        expect(options.sourceUrl).toBeNull();
        expect(options.replayState).toMatchObject({
            status: 'processing',
            title: 'Replay is processing'
        });
    });

    it('plays ready replay video through the recorded controls', () => {
        const options = resolveReplayVideoOptions({
            team: {},
            game: {
                liveStatus: 'completed',
                replayVideo: {
                    status: 'ready',
                    url: 'https://cdn.example.com/ready.mp4'
                }
            },
            isReplay: true
        });

        expect(options.mode).toBe('recorded');
        expect(options.hasVideo).toBe(true);
        expect(options.sourceUrl).toBe('https://cdn.example.com/ready.mp4');
        expect(options.replayState).toBeNull();
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

    it('refreshes the video panel when replay availability state changes', () => {
        expect(shouldReloadVideoPlayback(
            { mode: 'none', replayState: { status: 'processing', title: 'Replay is processing', message: 'Processing' } },
            { mode: 'none', replayState: { status: 'failed', title: 'Replay unavailable', message: 'Failed' } }
        )).toBe(true);
    });
});


describe('native camera capture authorization', () => {
    const scheduledGame = { status: 'scheduled', visibility: 'public' };

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

    it('allows selected videographers without granting full staff access', () => {
        expect(canAccessNativeCameraCapture({
            user: { uid: 'video-1', email: 'video@example.com' },
            team: {
                ownerId: 'owner-1',
                adminEmails: [],
                teamPermissions: {
                    videography: { mode: 'selected', memberIds: ['video-1'] }
                }
            },
            game: scheduledGame
        })).toBe(true);

        expect(canAccessNativeCameraCapture({
            user: { uid: 'video-2', email: 'video2@example.com' },
            team: {
                ownerId: 'owner-1',
                adminEmails: [],
                teamPermissions: {
                    videography: { mode: 'selected', memberIds: ['video-1'] }
                }
            },
            game: scheduledGame
        })).toBe(false);
    });

    it('allows Game Day streaming helpers with selected or confirmed access', () => {
        const selectedStreamingTeam = {
            ownerId: 'owner-1',
            adminEmails: [],
            teamPermissions: {
                streaming: { mode: 'selected', memberIds: ['stream-score-1'] }
            }
        };
        const selectedUser = { uid: 'stream-score-1', email: 'helper@example.com' };

        expect(canAccessNativeCameraCapture({
            user: selectedUser,
            team: selectedStreamingTeam,
            game: scheduledGame
        })).toBe(true);
        expect(canSaveBroadcastSetupSession({
            user: selectedUser,
            team: selectedStreamingTeam,
            game: scheduledGame
        })).toBe(true);

        const confirmedStreamingTeam = {
            ownerId: 'owner-1',
            adminEmails: [],
            teamPermissions: {
                streaming: { mode: 'all_confirmed', memberIds: [] }
            }
        };
        const confirmedUser = { uid: 'confirmed-streamer', email: 'confirmed@example.com' };
        expect(canAccessNativeCameraCapture({
            user: confirmedUser,
            team: confirmedStreamingTeam,
            game: scheduledGame,
            rsvp: { response: 'going' }
        })).toBe(true);
        expect(canSaveBroadcastSetupSession({
            user: confirmedUser,
            team: confirmedStreamingTeam,
            game: scheduledGame,
            rsvp: { response: 'going' }
        })).toBe(true);
        expect(canSaveBroadcastSetupSession({
            user: confirmedUser,
            team: confirmedStreamingTeam,
            game: scheduledGame,
            rsvp: null
        })).toBe(false);
    });

    it('mirrors Firestore broadcast-session write roles for setup saves', () => {
        const selectedVideoTeam = {
            ownerId: 'owner-1',
            adminEmails: [],
            mediaContributorUids: ['streamer-1'],
            teamPermissions: {
                videography: { mode: 'selected', memberIds: ['video-1'] }
            }
        };

        expect(canSaveBroadcastSetupSession({
            user: { uid: 'owner-1', email: 'owner@example.com' },
            team: selectedVideoTeam,
            game: scheduledGame
        })).toBe(true);
        expect(canSaveBroadcastSetupSession({
            user: { uid: 'admin-1', email: 'Admin@Example.com' },
            team: { ...selectedVideoTeam, adminEmails: ['admin@example.com'] },
            game: scheduledGame
        })).toBe(true);
        expect(canSaveBroadcastSetupSession({
            user: { uid: 'video-1', email: 'video@example.com' },
            team: selectedVideoTeam,
            game: scheduledGame
        })).toBe(true);
        expect(canSaveBroadcastSetupSession({
            user: { uid: 'streamer-1', email: 'streamer@example.com' },
            team: selectedVideoTeam,
            game: scheduledGame
        })).toBe(false);
    });

    it('blocks selected videographer broadcast setup on private non-shareable games', () => {
        const selectedVideoTeam = {
            ownerId: 'owner-1',
            adminEmails: [],
            teamPermissions: {
                videography: { mode: 'selected', memberIds: ['video-1'] }
            }
        };
        const privateGame = { status: 'scheduled', visibility: 'private' };
        const selectedUser = { uid: 'video-1', email: 'video@example.com' };

        expect(canAccessNativeCameraCapture({
            user: selectedUser,
            team: selectedVideoTeam,
            game: privateGame
        })).toBe(false);
        expect(canSaveBroadcastSetupSession({
            user: selectedUser,
            team: selectedVideoTeam,
            game: privateGame
        })).toBe(false);
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

describe('broadcast setup session helpers', () => {
    it('enables Begin Streaming only after camera and microphone readiness', () => {
        expect(resolveBroadcastStreamControlState({
            status: BROADCAST_STREAM_STATUSES.READY,
            cameraReady: true,
            microphoneReady: false
        })).toMatchObject({
            status: BROADCAST_STREAM_STATUSES.FAILED,
            label: 'Start failed',
            mediaReady: false,
            showBegin: false,
            beginDisabled: true,
            showRetry: true,
            isLive: false
        });

        expect(resolveBroadcastStreamControlState({
            status: BROADCAST_STREAM_STATUSES.READY,
            cameraReady: true,
            microphoneReady: true
        })).toMatchObject({
            status: BROADCAST_STREAM_STATUSES.READY,
            label: 'Ready to stream',
            mediaReady: true,
            showBegin: true,
            beginDisabled: false
        });
    });

    it('exposes explicit starting, live, and retryable failed states', () => {
        expect(resolveBroadcastStreamControlState({
            status: BROADCAST_STREAM_STATUSES.STARTING,
            cameraReady: true,
            microphoneReady: true
        })).toMatchObject({ label: 'Starting...', showBegin: false, isLive: false });
        expect(resolveBroadcastStreamControlState({
            status: BROADCAST_STREAM_STATUSES.LIVE,
            cameraReady: true,
            microphoneReady: true
        })).toMatchObject({ label: 'Live', showBegin: false, isLive: true });
        expect(resolveBroadcastStreamControlState({
            status: BROADCAST_STREAM_STATUSES.FAILED
        })).toMatchObject({ label: 'Start failed', showBegin: false, showRetry: true, isLive: false });
    });

    it('clears ready, starting, and live state when a camera or microphone track ends', () => {
        for (const status of [
            BROADCAST_STREAM_STATUSES.READY,
            BROADCAST_STREAM_STATUSES.STARTING,
            BROADCAST_STREAM_STATUSES.LIVE
        ]) {
            expect(resolveBroadcastStreamControlState({
                status,
                cameraReady: false,
                microphoneReady: true
            })).toMatchObject({
                status: BROADCAST_STREAM_STATUSES.FAILED,
                label: 'Start failed',
                mediaReady: false,
                showBegin: false,
                beginDisabled: true,
                showRetry: true,
                isLive: false
            });

            expect(resolveBroadcastStreamControlState({
                status,
                cameraReady: true,
                microphoneReady: false
            })).toMatchObject({
                status: BROADCAST_STREAM_STATUSES.FAILED,
                showRetry: true,
                isLive: false
            });
        }
    });

    it('builds a reusable ready session after camera and microphone verification', () => {
        const session = buildBroadcastSetupSession({
            sessionName: ' Varsity vs Central ',
            user: { uid: 'coach-1', email: 'coach@example.com' },
            permissions: { camera: true, microphone: true },
            status: BROADCAST_SETUP_STATUSES.READY,
            now: new Date('2026-05-10T07:30:00.000Z')
        });

        expect(session).toMatchObject({
            id: 'broadcast-1778398200000',
            name: 'Varsity vs Central',
            status: 'ready_for_managed_stream',
            provider: { type: 'managed_setup', name: 'ALL PLAYS managed setup' },
            permissions: { camera: true, microphone: true },
            updatedBy: 'coach-1',
            createdAt: '2026-05-10T07:30:00.000Z',
            updatedAt: '2026-05-10T07:30:00.000Z'
        });
    });

    it('preserves session identity and records retryable permission failures', () => {
        const session = buildBroadcastSetupSession({
            existingSession: { id: 'broadcast-existing', name: 'Existing session', createdAt: '2026-05-01T00:00:00.000Z' },
            sessionName: '',
            user: { uid: 'video-1' },
            permissions: { camera: false, microphone: false },
            status: BROADCAST_SETUP_STATUSES.FAILED,
            errorMessage: 'Permission denied. Allow access and retry.',
            now: new Date('2026-05-10T08:00:00.000Z')
        });

        expect(session).toMatchObject({
            id: 'broadcast-existing',
            name: 'Existing session',
            status: 'permission_failed',
            permissions: { camera: false, microphone: false },
            errorMessage: 'Permission denied. Allow access and retry.',
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-10T08:00:00.000Z'
        });
    });

    it('records external provider metadata and score correlation context', () => {
        expect(resolveBroadcastProviderMetadata({ twitchChannel: 'allplayslive' })).toEqual({
            type: BROADCAST_PROVIDER_TYPES.TWITCH,
            name: 'Twitch',
            channel: 'allplayslive'
        });

        const session = buildBroadcastSetupSession({
            sessionName: 'Game stream',
            provider: resolveBroadcastProviderMetadata({ youtubeEmbedUrl: 'https://www.youtube.com/embed/abc12345678' }),
            status: BROADCAST_SETUP_STATUSES.READY,
            permissions: { camera: true, microphone: true },
            now: new Date('2026-05-10T09:00:00.000Z')
        });

        expect(session.provider).toMatchObject({
            type: BROADCAST_PROVIDER_TYPES.YOUTUBE,
            name: 'YouTube',
            embedUrl: 'https://www.youtube.com/embed/abc12345678'
        });
        expect(buildStreamScoreContext({
            homeScore: 12,
            awayScore: 10,
            scoreUpdatedAt: '2026-05-10T09:05:00.000Z',
            broadcastSession: session
        })).toMatchObject({
            sessionId: session.id,
            streamStatus: BROADCAST_SETUP_STATUSES.READY,
            providerName: 'YouTube',
            score: { home: 12, away: 10 },
            scoreUpdatedAt: '2026-05-10T09:05:00.000Z',
            sessionUpdatedAt: '2026-05-10T09:00:00.000Z'
        });
    });
});
