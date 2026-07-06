import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveReplayVideoOptions } from '../../js/live-game-video.js';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('game report replay action', () => {
    it('gates the report replay action on usable replay media instead of completed status alone', () => {
        const html = readRepoFile('game.html');

        expect(html).toContain('resolveReplayVideoOptions');
        expect(html).toContain('renderReplayReportAction({ teamId, gameId, game })');
        expect(html).toContain('if (replayOptions.hasVideo)');
        expect(html).not.toContain("${game.liveStatus === 'completed' ? `");
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
});
