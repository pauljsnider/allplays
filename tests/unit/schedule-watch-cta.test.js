import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveScheduleWatchCta } from '../../js/schedule-watch-cta.js';

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

    it('returns a replay CTA for completed live games', () => {
        expect(resolveScheduleWatchCta(game({ status: 'completed', liveStatus: 'completed' }))).toEqual({
            kind: 'replay',
            label: 'Watch Replay',
            href: 'live-game.html?teamId=team-1&gameId=game-1&replay=true'
        });
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
        expect(resolveScheduleWatchCta(game({ teamId: '', liveStatus: 'live' }))).toBeNull();
        expect(resolveScheduleWatchCta(game({ id: '', gameId: '', liveStatus: 'completed' }))).toBeNull();
    });

    it('wires the CTA only into parent dashboard schedule renderers and preserves details links', () => {
        const parentDashboard = readRepoFile('parent-dashboard.html');
        const familyPage = readRepoFile('family.html');

        expect(parentDashboard).toContain("import { resolveScheduleWatchCta } from './js/schedule-watch-cta.js?v=1';");
        expect(parentDashboard).toContain('const watchCta = resolveScheduleWatchCta(game);');
        expect(parentDashboard).toContain('liveStatus: game.liveStatus || null,');
        expect(parentDashboard).toContain('View Details');

        expect(familyPage).not.toContain("import { resolveScheduleWatchCta } from './js/schedule-watch-cta.js?v=1';");
        expect(familyPage).not.toContain('const watchCta = resolveScheduleWatchCta(ev);');
        expect(familyPage).not.toContain('const watchCta = resolveScheduleWatchCta(game);');
        expect(familyPage).toContain('liveStatus: game.liveStatus || null,');
        expect(familyPage).toContain('View Game Details');
        expect(familyPage).toContain('>\n                  View\n');
    });
});
