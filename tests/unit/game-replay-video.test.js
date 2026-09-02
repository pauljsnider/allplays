import { describe, expect, it } from 'vitest';
import {
    buildYouTubeReplayVideo,
    fingerprintGameReplayArchiveState,
    getGameReplayArchiveState,
    getGameReplayLifecycle,
    hasGameReplayArchiveEvidence,
    normalizeYouTubeReplayUrl,
    resolveGameReplayPlaybackSource
} from '../../js/game-replay-video.js';

describe('YouTube game replay URLs', () => {
    const videoId = 'dQw4w9WgXcQ';
    const canonical = {
        provider: 'youtube',
        videoId,
        embedUrl: `https://www.youtube.com/embed/${videoId}`,
        publicUrl: `https://www.youtube.com/watch?v=${videoId}`
    };

    it.each([
        `https://youtube.com/watch?v=${videoId}&t=42#score`,
        `https://www.youtube.com/watch?v=${videoId}`,
        `https://m.youtube.com/watch?v=${videoId}&feature=share`,
        `https://youtube.com/live/${videoId}?si=share-token`,
        `https://www.youtube.com/embed/${videoId}?start=10`,
        `https://m.youtube.com/shorts/${videoId}#clip`,
        `https://youtu.be/${videoId}?si=share-token`,
        `https://youtube-nocookie.com/embed/${videoId}`,
        `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`
    ])('canonicalizes an exact YouTube video URL: %s', (value) => {
        expect(normalizeYouTubeReplayUrl(value)).toEqual(canonical);
    });

    it.each([
        `http://www.youtube.com/watch?v=${videoId}`,
        `https://user:secret@www.youtube.com/watch?v=${videoId}`,
        `https://www.youtube.com:443/watch?v=${videoId}`,
        `https://www.youtube.com:8443/watch?v=${videoId}`,
        'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw',
        'https://www.youtube.com/embed/live_stream?channel=UC_x5XG1OV2P6uZZ5FSM9Ttw',
        'https://www.youtube.com/live/live_stream',
        'https://www.youtube.com/watch?v=too-short',
        'https://www.youtube.com/watch?v=abcdefghij!',
        `https://www.youtube.com.evil.example/watch?v=${videoId}`,
        `https://youtu.be/${videoId}/extra`,
        `https://www.youtube-nocookie.com/watch?v=${videoId}`,
        `https://www.youtube.com/watch?v=${videoId}&v=abcdefghijk`,
        `https://www.youtube.com/playlist?list=${videoId}`,
        'not a URL',
        ''
    ])('rejects a URL that does not identify one safe YouTube video: %s', (value) => {
        expect(normalizeYouTubeReplayUrl(value)).toBeNull();
    });

    it('builds the canonical persisted replayVideo shape', () => {
        const linkedAt = { seconds: 1_788_192_000, nanoseconds: 0 };

        expect(buildYouTubeReplayVideo(`https://youtu.be/${videoId}`, {
            title: '  Vipers vs Captains replay  ',
            linkedBy: ' coach-1 ',
            linkedAt
        })).toEqual({
            ...canonical,
            status: 'ready',
            title: 'Vipers vs Captains replay',
            linkedBy: 'coach-1',
            linkedAt
        });
    });

    it('returns null instead of persisting an invalid source', () => {
        expect(buildYouTubeReplayVideo('https://www.youtube.com/embed/live_stream')).toBeNull();
    });

    it('ignores invalid optional metadata without weakening the replay URL', () => {
        expect(buildYouTubeReplayVideo(`https://youtu.be/${videoId}`, null)).toEqual({
            ...canonical,
            status: 'ready'
        });
    });

    it.each([
        ['replayVideo.publicUrl', { replayVideo: { publicUrl: `https://youtu.be/${videoId}?si=legacy` } }],
        ['recordedVideo.publicUrl', { recordedVideo: { publicUrl: `https://www.youtube.com/live/${videoId}` } }],
        ['videoReplay.publicUrl', { videoReplay: { publicUrl: `https://m.youtube.com/shorts/${videoId}` } }],
        ['replayVideo.embedUrl', { replayVideo: { embedUrl: `https://www.youtube.com/embed/${videoId}` } }],
        ['recordedVideo.embedUrl', { recordedVideo: { embedUrl: `https://www.youtube.com/embed/${videoId}` } }],
        ['videoReplay.videoId', { videoReplay: { videoId } }],
        ['replayVideoPublicUrl', { replayVideoPublicUrl: `https://www.youtube-nocookie.com/embed/${videoId}` }],
        ['completed videoUrl', { videoUrl: `https://www.youtube.com/watch?v=${videoId}&t=20` }]
    ])('normalizes provider-less historical %s playback', (_label, replayFields) => {
        expect(resolveGameReplayPlaybackSource({
            status: 'completed',
            liveStatus: 'scheduled',
            ...replayFields
        })).toMatchObject({
            state: 'playable',
            mode: 'embed',
            provider: 'youtube',
            videoId,
            sourceUrl: canonical.embedUrl,
            publicUrl: canonical.publicUrl
        });
    });

    it('keeps canonical replay precedence and requires historical aliases to agree on one video', () => {
        expect(resolveGameReplayPlaybackSource({
            replayVideo: { ...canonical, status: 'ready' },
            recordedVideo: 'malformed legacy value',
            replayVideoPublicUrl: 'javascript:alert(1)',
            videoUrl: 'https://example.com/watch?token=secret'
        })).toMatchObject({
            state: 'playable',
            sourceKind: 'canonical',
            sourceUrl: canonical.embedUrl,
            publicUrl: canonical.publicUrl
        });

        expect(resolveGameReplayPlaybackSource({
            replayVideo: { publicUrl: `https://youtu.be/${videoId}` },
            recordedVideo: { publicUrl: `https://www.youtube.com/watch?v=${videoId}&t=30` },
            videoReplay: { src: `https://www.youtube.com/embed/${videoId}?start=4` },
            replayVideoPublicUrl: `https://www.youtube.com/live/${videoId}`
        })).toMatchObject({
            state: 'playable',
            mode: 'embed',
            videoId,
            sourceUrl: canonical.embedUrl,
            publicUrl: canonical.publicUrl
        });

        expect(resolveGameReplayPlaybackSource({
            replayVideo: { publicUrl: `https://youtu.be/${videoId}` },
            recordedVideo: { publicUrl: 'https://youtu.be/abcdefghijk' }
        })).toEqual({ state: 'invalid' });
    });

    it.each([
        ['nested HTTPS source', { replayVideo: { url: 'https://cdn.example.com/game.mp4' } }, 'https://cdn.example.com/game.mp4'],
        ['nested HTTP source', { recordedVideo: { src: 'http://media.example.com/game.mp4' } }, 'http://media.example.com/game.mp4'],
        ['flat HTTPS source', { archivedVideoUrl: 'https://cdn.example.com/archive.m3u8' }, 'https://cdn.example.com/archive.m3u8']
    ])('preserves a credential-free absolute %s', (_label, replayFields, expectedSource) => {
        expect(resolveGameReplayPlaybackSource(replayFields)).toMatchObject({
            state: 'playable',
            mode: 'recorded',
            sourceUrl: expectedSource,
            publicUrl: null
        });
    });

    it.each([
        [{ replayVideo: { url: 'https://cdn.example.com/game.mp4', publicUrl: 'https://video.example.com/watch/game-1' } }],
        [{ recordedVideo: { src: 'http://media.example.com/game.mp4' }, replayVideoPublicUrl: 'https://video.example.com/watch/game-1' }]
    ])('preserves a safe generic public URL only as a companion to direct media %#', (replayFields) => {
        expect(resolveGameReplayPlaybackSource(replayFields)).toMatchObject({
            state: 'playable',
            mode: 'recorded',
            publicUrl: 'https://video.example.com/watch/game-1'
        });
    });

    it.each([
        ['nested javascript source', { replayVideo: { url: 'javascript:alert(1)' } }],
        ['nested data source', { recordedVideo: { src: 'data:video/mp4;base64,AAAA' } }],
        ['nested credential source', { videoReplay: { url: 'https://user:secret@cdn.example.com/game.mp4' } }],
        ['flat javascript source', { replayVideoUrl: 'javascript:alert(1)' }],
        ['flat data source', { recordedVideoUrl: 'data:video/mp4;base64,AAAA' }],
        ['flat credential source', { archivedVideoUrl: 'https://user:secret@cdn.example.com/game.mp4' }],
        ['nested generic public URL', { replayVideo: { publicUrl: 'https://video.example.com/watch?token=secret' } }],
        ['nested javascript public URL', { recordedVideo: { publicUrl: 'javascript:alert(1)' } }],
        ['nested credential public URL', { videoReplay: { publicUrl: `https://user:secret@youtu.be/${videoId}` } }],
        ['flat data public URL', { replayVideoPublicUrl: 'data:text/html,unsafe' }],
        ['flat credential public URL', { replayVideoPublicUrl: `https://user:secret@youtu.be/${videoId}` }],
        ['string replay container', { replayVideo: `https://youtu.be/${videoId}` }],
        ['array replay container', { recordedVideo: [`https://youtu.be/${videoId}`] }]
    ])('rejects %s before it reaches a playback or link sink', (_label, replayFields) => {
        expect(resolveGameReplayPlaybackSource(replayFields)).toEqual({ state: 'invalid' });
    });

    it('blocks invalid public evidence beside a direct source and ignores videoUrl beside a higher-precedence direct source', () => {
        for (const publicUrl of [
            'javascript:alert(1)',
            'data:text/html,unsafe',
            'https://user:secret@video.example.com/watch/game-1'
        ]) {
            expect(resolveGameReplayPlaybackSource({
                replayVideo: {
                    url: 'https://cdn.example.com/game.mp4',
                    publicUrl
                }
            })).toEqual({ state: 'invalid' });
        }

        expect(resolveGameReplayPlaybackSource({
            replayVideo: { url: 'https://cdn.example.com/game.mp4' },
            status: 'completed',
            liveStatus: 'scheduled',
            videoUrl: 'https://video.example.com/watch?token=secret'
        })).toMatchObject({
            state: 'playable',
            mode: 'recorded',
            sourceUrl: 'https://cdn.example.com/game.mp4'
        });
    });

    it.each([
        ['processing', { replayStatus: 'processing' }, 'blocked'],
        ['failed', { recordedReplayStatus: 'failed' }, 'blocked'],
        ['unknown', { videoReplayStatus: 'mystery' }, 'invalid'],
        ['nested unknown', { recordedVideo: { status: 'mystery', src: 'https://cdn.example.com/game.mp4' } }, 'invalid']
    ])('fails closed for %s replay availability', (_label, statusFields, state) => {
        expect(resolveGameReplayPlaybackSource({
            replayVideoUrl: 'https://cdn.example.com/game.mp4',
            ...statusFields
        })).toEqual({ state });
    });

    it('only accepts the videoUrl fallback for an ordered completed lifecycle', () => {
        const videoUrl = `https://youtu.be/${videoId}`;
        expect(resolveGameReplayPlaybackSource({
            status: 'completed',
            liveStatus: 'scheduled',
            videoUrl
        }).state).toBe('playable');
        expect(resolveGameReplayPlaybackSource({
            status: 'scheduled',
            liveStatus: 'completed',
            videoUrl
        })).toEqual({ state: 'none' });
        expect(resolveGameReplayPlaybackSource({
            status: 'completed',
            liveStatus: 'live',
            videoUrl
        })).toEqual({ state: 'none' });
        expect(resolveGameReplayPlaybackSource({
            status: 'completed',
            liveStatus: 'scheduled',
            videoUrl: 'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw'
        })).toEqual({ state: 'invalid' });
    });

    it('keeps a removed canonical replay from resurfacing an older videoUrl fallback', () => {
        const oldVideoUrl = `https://youtu.be/${videoId}`;
        const linked = resolveGameReplayPlaybackSource({
            status: 'completed',
            liveStatus: 'scheduled',
            videoUrl: oldVideoUrl,
            replayVideo: { ...canonical, status: 'ready' }
        });
        expect(linked).toMatchObject({ state: 'playable', sourceKind: 'canonical' });

        const removedGame = {
            status: 'completed',
            liveStatus: 'scheduled',
            videoUrl: oldVideoUrl,
            replayVideo: null,
            replayVideoFallbackDisabled: true
        };
        expect(resolveGameReplayPlaybackSource(removedGame)).toEqual({ state: 'none' });
        expect(hasGameReplayArchiveEvidence(removedGame)).toBe(false);
    });

    it.each([
        ['generic URL', 'https://video.example.com/watch/game-1'],
        ['tokenized media URL', 'https://cdn.example.com/game.mp4?token=secret'],
        ['Firebase token URL', 'https://firebasestorage.googleapis.com/v0/b/project/o/game.mp4?token=secret'],
        ['YouTube channel URL', 'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw'],
        ['YouTube live channel URL', 'https://www.youtube.com/embed/live_stream?channel=UC_x5XG1OV2P6uZZ5FSM9Ttw'],
        ['insecure YouTube URL', `http://www.youtube.com/watch?v=${videoId}`],
        ['credential YouTube URL', `https://user:secret@www.youtube.com/watch?v=${videoId}`]
    ])('rejects completed videoUrl fallback %s', (_label, videoUrl) => {
        expect(resolveGameReplayPlaybackSource({
            status: 'completed',
            liveStatus: 'scheduled',
            videoUrl
        })).toEqual({ state: 'invalid' });
    });

    it.each([
        [{ status: 'completed', liveStatus: 'scheduled' }, true, false],
        [{ status: 'final', liveStatus: 'completed' }, true, false],
        [{ liveStatus: 'final' }, true, false],
        [{ status: 'scheduled', liveStatus: 'live' }, false, true],
        [{ status: 'live', liveStatus: 'live' }, false, true],
        [{ status: 'scheduled', liveStatus: 'completed' }, false, false],
        [{ status: 'completed', liveStatus: 'live' }, false, false],
        [{ status: 'completed', liveStatus: 'cancelled' }, false, false],
        [{ status: 'cancelled', liveStatus: 'completed' }, false, false],
        [{ status: 'scheduled', liveStatus: 'live', isCancelled: true }, false, false],
        [{ status: 'completed', liveStatus: 'scheduled', deleted: true }, false, false],
        [{ type: 'practice', status: 'completed', liveStatus: 'scheduled' }, false, false],
        [{ type: 'Game', status: 'completed', liveStatus: 'scheduled' }, false, false],
        [{ status: 'completed', liveStatus: {} }, false, false],
        [{ status: [], liveStatus: 'completed' }, false, false],
        [{ status: 'completed', liveStatus: [] }, false, false],
        [{ status: 'completed', liveStatus: true }, false, false],
        [{ status: 1, liveStatus: 'completed' }, false, false],
        [{ status: 'mystery', liveStatus: 'live' }, false, false]
    ])('classifies ordered replay/live lifecycle %#', (game, isCompleted, isActiveLive) => {
        expect(getGameReplayLifecycle(game)).toMatchObject({ isCompleted, isActiveLive });
    });

    it('captures every replay alias consumed by playback', () => {
        const game = {
            id: 'game-1',
            replayVideo: null,
            recordedVideo: { url: 'https://cdn.example/replay.mp4' },
            videoReplayUrl: 'https://cdn.example/legacy.mp4',
            replayVideoPublicUrl: 'https://video.example/replay',
            replayStatus: 'ready',
            unrelated: true
        };

        expect(getGameReplayArchiveState(game)).toEqual({
            replayVideo: null,
            recordedVideo: { url: 'https://cdn.example/replay.mp4' },
            videoReplayUrl: 'https://cdn.example/legacy.mp4',
            replayVideoPublicUrl: 'https://video.example/replay',
            replayStatus: 'ready'
        });
        expect(hasGameReplayArchiveEvidence(game)).toBe(true);
        expect(hasGameReplayArchiveEvidence({ replayVideo: null, archivedVideoUrl: '   ' })).toBe(false);
        expect(hasGameReplayArchiveEvidence({
            status: 'completed',
            liveStatus: 'scheduled',
            videoUrl: `https://youtu.be/${videoId}`
        })).toBe(true);
        expect(hasGameReplayArchiveEvidence({
            status: 'completed',
            liveStatus: 'scheduled',
            videoUrl: `https://youtu.be/${videoId}`,
            replayVideoFallbackDisabled: true
        })).toBe(false);
    });

    it('fingerprints the complete raw archive state deterministically', () => {
        const firstTimestamp = {
            seconds: 1_788_192_000,
            nanoseconds: 123,
            toDate() {
                return new Date('2026-09-01T00:00:00.000Z');
            }
        };
        const equivalentTimestamp = {
            nanoseconds: 123,
            seconds: 1_788_192_000,
            toDate() {
                return new Date('2026-09-01T00:00:00.000Z');
            }
        };

        expect(fingerprintGameReplayArchiveState({
            replayVideo: { linkedAt: firstTimestamp, nested: { b: 2, a: 1 } },
            recordedVideo: { url: 'https://cdn.example/a.mp4' }
        })).toBe(fingerprintGameReplayArchiveState({
            recordedVideo: { url: 'https://cdn.example/a.mp4' },
            replayVideo: { nested: { a: 1, b: 2 }, linkedAt: equivalentTimestamp }
        }));

        expect(fingerprintGameReplayArchiveState({
            recordedVideo: { url: 'https://cdn.example/a.mp4' }
        })).not.toBe(fingerprintGameReplayArchiveState({
            recordedVideo: { url: 'https://cdn.example/b.mp4' }
        }));

        expect(fingerprintGameReplayArchiveState({
            replayVideo: { provider: 'youtube', futureField: 'first' }
        })).not.toBe(fingerprintGameReplayArchiveState({
            replayVideo: { provider: 'youtube', futureField: 'second' }
        }));

        const linkedAtDate = new Date('2026-09-01T12:34:56.789Z');
        const linkedAtMillis = linkedAtDate.getTime();
        expect(fingerprintGameReplayArchiveState({
            replayVideo: { linkedAt: linkedAtDate }
        })).toBe(fingerprintGameReplayArchiveState({
            replayVideo: {
                linkedAt: {
                    seconds: Math.floor(linkedAtMillis / 1000),
                    nanoseconds: (linkedAtMillis % 1000) * 1_000_000,
                    toDate() {
                        return linkedAtDate;
                    }
                }
            }
        }));
    });
});
