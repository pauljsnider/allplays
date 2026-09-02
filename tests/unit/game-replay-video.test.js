import { describe, expect, it } from 'vitest';
import {
    buildYouTubeReplayVideo,
    fingerprintGameReplayArchiveState,
    getGameReplayArchiveState,
    hasGameReplayArchiveEvidence,
    normalizeYouTubeReplayUrl
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
