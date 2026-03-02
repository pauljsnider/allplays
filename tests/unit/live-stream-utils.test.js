import { describe, expect, it } from 'vitest';
import { computePanelVisibility, normalizeYouTubeEmbedUrl } from '../../js/live-stream-utils.js';

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
