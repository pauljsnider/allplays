import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveReplayVideoOptions } from '../../js/live-game-video.js';
import { resolveGameReportReplayPreview } from '../../js/game-report-replay-preview.js';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('game report replay action', () => {
    it('gates the report replay action on usable replay media instead of completed status alone', () => {
        const html = readRepoFile('game.html');

        expect(html).toContain('resolveReplayVideoOptions');
        expect(html).toContain('renderReplayReportAction({ teamId, gameId, game, team })');
        expect(html).toMatch(/resolveReplayVideoOptions\(\{\s*team,\s*game,\s*isReplay: true\s*\}\)/);
        expect(html).toContain('renderReplayReportAction({ teamId, gameId, game, team: resolvedTeam })');
        expect(html).toContain('replayOptions.hasVideo && replayOptions.isRecordedReplay === true');
        expect(html).toContain('data-replay-video-preview');
        expect(html).toContain('Video available');
        expect(html).toContain('Watch replay');
        expect(html).toContain('resolveGameReportReplayPreview');
        expect(html).toContain('const hasCompletedTimelineReplay');
        expect(html).toContain('aria-label="View game replay"');
        expect(html).not.toContain("${game.liveStatus === 'completed' ? `");
    });

    it('uses a compact YouTube thumbnail when the replay URL identifies a video', () => {
        expect(resolveGameReportReplayPreview({
            sourceUrl: 'https://www.youtube.com/embed/T3f9AjVhn9U?autoplay=1',
            publicUrl: 'https://www.youtube.com/watch?v=T3f9AjVhn9U'
        })).toEqual({
            thumbnailUrl: 'https://i.ytimg.com/vi/T3f9AjVhn9U/mqdefault.jpg',
            providerLabel: 'YouTube',
            accessibleLabel: 'Video available. Watch the full game replay on YouTube.'
        });
    });

    it('prefers a safe supplied poster and supports youtu.be URLs', () => {
        expect(resolveGameReportReplayPreview({
            sourceUrl: 'https://youtu.be/T3f9AjVhn9U',
            posterUrl: 'https://cdn.example.com/posters/game-1.jpg'
        })).toMatchObject({
            thumbnailUrl: 'https://cdn.example.com/posters/game-1.jpg',
            providerLabel: 'YouTube'
        });
    });

    it('does not use unsafe poster URLs or infer thumbnails from unrelated URLs', () => {
        expect(resolveGameReportReplayPreview({
            sourceUrl: 'https://youtube.com.attacker.example/embed/T3f9AjVhn9U',
            posterUrl: 'javascript:alert(1)'
        })).toEqual({
            thumbnailUrl: null,
            providerLabel: 'Video',
            accessibleLabel: 'Video available. Watch the full game replay.'
        });
    });

    it('uses explicit non-clickable replay states for completed games without watchable replay media', () => {
        const processing = resolveReplayVideoOptions({
            game: {
                liveStatus: 'completed',
                replayVideo: { status: 'processing' }
            },
            isReplay: true
        });
        const failed = resolveReplayVideoOptions({
            game: {
                liveStatus: 'completed',
                replayVideo: { status: 'failed' }
            },
            isReplay: true
        });
        const unavailable = resolveReplayVideoOptions({
            game: {
                liveStatus: 'completed'
            },
            isReplay: true
        });
        const ready = resolveReplayVideoOptions({
            game: {
                liveStatus: 'completed',
                replayVideo: {
                    status: 'ready',
                    url: 'https://cdn.example.com/game-1.mp4'
                }
            },
            isReplay: true
        });

        expect(processing.hasVideo).toBe(false);
        expect(processing.replayState?.status).toBe('processing');
        expect(failed.hasVideo).toBe(false);
        expect(failed.replayState?.status).toBe('failed');
        expect(unavailable.hasVideo).toBe(false);
        expect(unavailable.replayState?.status).toBe('unavailable');
        expect(ready.hasVideo).toBe(true);
        expect(ready.replayState).toBeNull();
    });

    it('does not treat a team live channel as the replay for a completed game', () => {
        const youtube = resolveReplayVideoOptions({
            team: { youtubeVideoId: 'abcdefghijk' },
            game: { liveStatus: 'completed' },
            isReplay: true
        });
        const twitch = resolveReplayVideoOptions({
            team: { twitchChannel: 'allplays' },
            game: { status: 'completed' },
            isReplay: true
        });

        expect(youtube.hasVideo).toBe(false);
        expect(youtube.mode).toBe('none');
        expect(youtube.replayState?.status).toBe('unavailable');
        expect(twitch.hasVideo).toBe(false);
        expect(twitch.mode).toBe('none');
        expect(twitch.replayState?.status).toBe('unavailable');
    });
});
