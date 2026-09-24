import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hasReplayVideoEvidence, resolveScheduleWatchCta } from '../../js/schedule-watch-cta.js';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function game(overrides = {}) {
    return {
        id: 'game-1',
        teamId: 'team-1',
        type: 'game',
        status: 'scheduled',
        liveStatus: 'scheduled',
        visibility: 'public',
        isPrivate: false,
        isCancelled: false,
        ...overrides
    };
}

describe('schedule watch CTA resolver', () => {
    it('returns a live CTA for active public games', () => {
        expect(resolveScheduleWatchCta(game({ liveStatus: 'live' }))).toEqual({
            kind: 'live',
            label: 'Watch Live',
            href: 'live-game.html?teamId=team-1&gameId=game-1'
        });
    });

    it('returns a replay CTA for supported completed-game lifecycles', () => {
        expect(resolveScheduleWatchCta(game({
            status: 'completed',
            liveStatus: 'completed',
            hasReplayVideo: true
        }))).toEqual({
            kind: 'replay',
            label: 'Watch Replay',
            href: 'live-game.html?teamId=team-1&gameId=game-1&replay=true'
        });
        expect(resolveScheduleWatchCta(game({
            status: 'completed',
            liveStatus: 'scheduled',
            replayVideo: { publicUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
        }))).toEqual({
            kind: 'replay',
            label: 'Watch Replay',
            href: 'live-game.html?teamId=team-1&gameId=game-1&replay=true'
        });
        expect(resolveScheduleWatchCta(game({
            status: 'final',
            liveStatus: '',
            recordedVideoUrl: 'https://cdn.example.com/replay.mp4'
        }))).toEqual({
            kind: 'replay',
            label: 'Watch Replay',
            href: 'live-game.html?teamId=team-1&gameId=game-1&replay=true'
        });
        expect(resolveScheduleWatchCta(game({
            status: 'completed',
            liveStatus: 'scheduled',
            hasReplayVideo: true
        }))).toEqual({
            kind: 'replay',
            label: 'Watch Replay',
            href: 'live-game.html?teamId=team-1&gameId=game-1&replay=true'
        });
        expect(resolveScheduleWatchCta(game({
            status: '',
            liveStatus: 'final',
            hasReplayVideo: false
        }))).toEqual({
            kind: 'replay',
            label: 'Watch Replay',
            href: 'live-game.html?teamId=team-1&gameId=game-1&replay=true'
        });
        expect(resolveScheduleWatchCta(game({
            status: 'completed',
            liveStatus: 'completed',
            hasReplayVideo: false
        }))).toEqual({
            kind: 'replay',
            label: 'Watch Replay',
            href: 'live-game.html?teamId=team-1&gameId=game-1&replay=true'
        });
    });

    it.each([
        { status: ' FINAL ', liveStatus: 'scheduled', hasReplayVideo: true },
        { status: 'FINAL', liveStatus: 'scheduled', hasReplayVideo: true },
        { status: 'scheduled', liveStatus: ' LIVE ' },
        { status: 'SCHEDULED', liveStatus: 'live' },
        { type: 'practice', status: 'scheduled', liveStatus: 'live' }
    ])('does not expose watch actions for an inexact lifecycle %#', (lifecycle) => {
        expect(resolveScheduleWatchCta(game(lifecycle))).toBeNull();
    });

    it('accepts safe server evidence and direct historical playback sources', () => {
        expect(hasReplayVideoEvidence(game({ hasReplayVideo: true }))).toBe(true);
        expect(hasReplayVideoEvidence(game({
            recordedVideo: { src: 'https://cdn.example.com/replay.mp4' }
        }))).toBe(true);
        expect(hasReplayVideoEvidence(game({
            recordedVideo: {
                src: 'https://cdn.example.com/replay.mp4',
                publicUrl: 'https://video.example.com/watch/replay-1'
            }
        }))).toBe(true);
        expect(hasReplayVideoEvidence(game({
            status: 'completed',
            liveStatus: 'scheduled',
            videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        }))).toBe(true);
        expect(hasReplayVideoEvidence(game({ replayVideo: 'legacy-recording' }))).toBe(false);
        expect(hasReplayVideoEvidence(game({ recordedVideo: ['https://cdn.example.com/replay.mp4'] }))).toBe(false);
        expect(hasReplayVideoEvidence(game({ videoUrl: 'https://example.com/live' }))).toBe(false);
        expect(hasReplayVideoEvidence(game({ replayVideoTitle: 'No source' }))).toBe(false);
    });

    it.each([
        ['replayVideo.publicUrl', { replayVideo: { publicUrl: 'https://youtu.be/dQw4w9WgXcQ' } }],
        ['recordedVideo.publicUrl', { recordedVideo: { publicUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }],
        ['videoReplay.publicUrl', { videoReplay: { publicUrl: 'https://www.youtube.com/live/dQw4w9WgXcQ' } }],
        ['replayVideoPublicUrl', { replayVideoPublicUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ' }],
        ['completed videoUrl', { videoUrl: 'https://m.youtube.com/shorts/dQw4w9WgXcQ' }]
    ])('recognizes playable historical %s evidence', (_label, replayFields) => {
        expect(hasReplayVideoEvidence(game({
            status: 'completed',
            liveStatus: 'scheduled',
            ...replayFields
        }))).toBe(true);
    });

    it.each([
        ['nested javascript source', { replayVideo: { url: 'javascript:alert(1)' } }],
        ['nested data source', { recordedVideo: { src: 'data:video/mp4;base64,AAAA' } }],
        ['nested credential source', { videoReplay: { url: 'https://user:secret@cdn.example.com/replay.mp4' } }],
        ['flat javascript source', { replayVideoUrl: 'javascript:alert(1)' }],
        ['flat data source', { recordedVideoUrl: 'data:video/mp4;base64,AAAA' }],
        ['flat credential source', { archivedVideoUrl: 'https://user:secret@cdn.example.com/replay.mp4' }],
        ['nested generic public URL', { replayVideo: { publicUrl: 'https://video.example.com/replay?token=secret' } }],
        ['nested javascript public URL', { recordedVideo: { publicUrl: 'javascript:alert(1)' } }],
        ['nested credential public URL', { videoReplay: { publicUrl: 'https://user:secret@youtu.be/dQw4w9WgXcQ' } }],
        ['flat data public URL', { replayVideoPublicUrl: 'data:text/html,unsafe' }],
        ['flat credential public URL', { replayVideoPublicUrl: 'https://user:secret@youtu.be/dQw4w9WgXcQ' }]
    ])('rejects unsafe %s evidence', (_label, replayFields) => {
        expect(hasReplayVideoEvidence(game({
            status: 'completed',
            liveStatus: 'scheduled',
            hasReplayVideo: true,
            ...replayFields
        }))).toBe(false);
    });

    it.each([
        { replayStatus: 'processing' },
        { recordedReplayStatus: 'failed' },
        { videoReplayStatus: 'mystery' },
        { replayVideo: { status: 'unknown', url: 'https://cdn.example.com/replay.mp4' } }
    ])('rejects blocked or unknown replay availability %#', (statusFields) => {
        expect(hasReplayVideoEvidence(game({
            hasReplayVideo: true,
            replayVideoUrl: 'https://cdn.example.com/replay.mp4',
            ...statusFields
        }))).toBe(false);
    });

    it('suppresses CTAs for practices, cancelled/deleted/private games, scheduled games, and records without viewer routes', () => {
        expect(resolveScheduleWatchCta(game({ type: 'practice', liveStatus: 'live' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ status: 'cancelled', liveStatus: 'live' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ isCancelled: true, liveStatus: 'completed' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ status: 'deleted', liveStatus: 'live' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ liveStatus: 'deleted' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ visibility: 'private', liveStatus: 'live' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ isPrivate: true, liveStatus: 'completed' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ liveStatus: 'scheduled' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ status: 'completed', liveStatus: 'scheduled' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ status: 'final', liveStatus: '' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ status: 'scheduled', liveStatus: 'completed' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ status: 'completed', liveStatus: 'live' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ status: 'completed', liveStatus: 'cancelled' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ status: 'cancelled', liveStatus: 'completed' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ teamId: '', liveStatus: 'live' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ id: '', gameId: '', liveStatus: 'completed' }))).toBeNull();
    });

    it('wires the CTA into parent and family schedule renderers while preserving details links', () => {
        const parentDashboard = readRepoFile('parent-dashboard.html');
        const familyPage = readRepoFile('family.html');
        const teamPage = readRepoFile('team.html');
        const editSchedulePage = readRepoFile('edit-schedule.html');
        const gamePage = readRepoFile('game.html');
        const ctaSource = readRepoFile('js/schedule-watch-cta.js');

        expect(ctaSource).toContain("from './game-replay-video.js?v=3';");

        expect(parentDashboard).toContain("import { hasReplayVideoEvidence, resolveScheduleWatchCta } from './js/schedule-watch-cta.js?v=3';");
        expect(parentDashboard).toContain('const watchCta = resolveScheduleWatchCta(game);');
        expect(parentDashboard).toContain('liveStatus: game.liveStatus || null,');
        expect(parentDashboard).toContain('hasReplayVideo: hasReplayVideoEvidence(game),');
        expect(parentDashboard).toContain('View Details');

        expect(familyPage).toContain("import { hasReplayVideoEvidence, resolveScheduleWatchCta } from './js/schedule-watch-cta.js?v=3';");
        expect(familyPage).toContain('const watchCta = ev.canOpenPublicViewer === true ? resolveScheduleWatchCta(ev) : null;');
        expect(familyPage).toContain('const watchCta = game.canOpenPublicViewer === true ? resolveScheduleWatchCta(game) : null;');
        expect(familyPage).toContain('liveStatus: game.liveStatus || null,');
        expect(familyPage).toContain('hasReplayVideo: hasReplayVideoEvidence(game),');
        expect(familyPage).toContain('visibility: game.visibility || null,');
        expect(familyPage).toContain('isPrivate: game.isPrivate === true,');
        expect(familyPage).toContain('${watchCta.label}');
        expect(familyPage).toContain('href="${watchCta.href}"');
        expect(familyPage).toContain('View Game Details');
        expect(familyPage).toContain('>\n                  View\n');

        expect(teamPage).toContain('const hasReplayLifecycle = !isPractice');
        expect(teamPage).toContain("import { getGameReplayLifecycle } from './js/game-replay-video.js?v=3';");
        expect(teamPage).toContain("import { hasReplayVideoEvidence } from './js/schedule-watch-cta.js?v=3';");
        expect(teamPage).toContain('const lifecycle = getGameReplayLifecycle({');
        expect(teamPage).toContain("type: isPractice ? 'practice' : 'game'");
        expect(teamPage).toContain('finalStatuses.has(normalizedLiveStatus) || hasReplayVideoEvidence(game)');
        expect(teamPage).toContain('const hasReplayPlayback = hasReplayLifecycle');
        expect(teamPage).toContain('${hasReplayPlayback ? `');

        expect(editSchedulePage).toContain('const lifecycle = getGameReplayLifecycle(game);');
        expect(editSchedulePage).toContain("import { getGameReplayLifecycle } from './js/game-replay-video.js?v=3';");
        expect(editSchedulePage).toContain("import { hasReplayVideoEvidence } from './js/schedule-watch-cta.js?v=3';");
        expect(editSchedulePage).toContain('finalStatuses.has(liveStatus) || hasReplayVideoEvidence(game)');
        expect(editSchedulePage).toContain('const hasReplayPlayback = hasReplayLifecycle');
        expect(editSchedulePage).toContain('${hasReplayPlayback ? `<a href="live-game.html');
        expect(gamePage).toContain("from './js/game-replay-video.js?v=3';");
        expect(gamePage).toContain("from './js/live-game-video.js?v=443319';");
    });
});
