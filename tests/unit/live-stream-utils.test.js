import { describe, expect, it } from 'vitest';
import {
    buildVideoTimestampMetadata,
    computePanelVisibility,
    normalizeYouTubeEmbedUrl,
    resolveStreamRelativeTimestampMs
} from '../../js/live-stream-utils.js';

describe('live stream URL normalization', () => {
    it('preserves channel query when normalizing live_stream embed URLs', () => {
        const normalized = normalizeYouTubeEmbedUrl(
            'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ&controls=0'
        );
        expect(normalized).toContain('channel=UCa9ghvbup6VQmnDOdqwYpqQ');
        expect(normalized).toContain('controls=0');
        expect(normalized).toContain('autoplay=1');
        expect(normalized).toContain('mute=1');
    });
});

describe('video timestamp metadata', () => {
    it('records stream-relative timestamps for scoring events when a stream start exists', () => {
        const metadata = buildVideoTimestampMetadata({
            team: { twitchChannel: 'allplayslive' },
            game: { liveStreamStartedAtMs: 10000 },
            nowMs: 42500,
            gameClockMs: 32000,
            isScoringEvent: true
        });

        expect(metadata.videoTimestampCaptureActive).toBe(true);
        expect(metadata.streamRelativeTimestampMs).toBe(32500);
        expect(metadata.videoTimestampUnavailableReason).toBeNull();
    });

    it('uses a game-level stream offset when no stream start is available', () => {
        expect(resolveStreamRelativeTimestampMs({
            game: { videoTimestampOffsetMs: 5000 },
            gameClockMs: 30000
        })).toBe(35000);
    });

    it('stores an explicit null reason when stream timing is unavailable', () => {
        const metadata = buildVideoTimestampMetadata({
            team: { streamEmbedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ' },
            game: {},
            nowMs: 42500,
            isScoringEvent: true
        });

        expect(metadata.videoTimestampCaptureActive).toBe(false);
        expect(metadata.streamRelativeTimestampMs).toBeNull();
        expect(metadata.videoTimestampUnavailableReason).toBe('stream_start_or_offset_unavailable');
    });

    it('does not add video metadata to non-scoring events', () => {
        expect(buildVideoTimestampMetadata({
            team: { twitchChannel: 'allplayslive' },
            game: { liveStreamStartedAtMs: 10000 },
            nowMs: 42500,
            isScoringEvent: false
        })).toEqual({});
    });
});

describe('video panel visibility', () => {
    it('keeps desktop video panel hidden when no stream exists', () => {
        const visibility = computePanelVisibility({
            isMobile: false,
            activeTab: 'plays',
            hasVideoStream: false
        });
        expect(visibility.videoHidden).toBe(true);
        expect(visibility.playsHidden).toBe(false);
    });

    it('routes mobile away from video tab when no stream exists', () => {
        const visibility = computePanelVisibility({
            isMobile: true,
            activeTab: 'video',
            hasVideoStream: false
        });
        expect(visibility.activeTab).toBe('plays');
        expect(visibility.videoHidden).toBe(true);
        expect(visibility.playsHidden).toBe(false);
    });
});
