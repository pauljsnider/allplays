import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readDbSource() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function getFunctionSource(source, functionName) {
    const start = source.indexOf(`export async function ${functionName}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextExport = source.indexOf('\nexport async function ', start + 1);
    return source.slice(start, nextExport === -1 ? source.length : nextExport);
}

describe('homepage shared game discovery queries', () => {
    it('includes sharedGames in live, upcoming, and replay homepage discovery', () => {
        const source = readDbSource();

        expect(source).toContain("collectionGroup(db, 'sharedGames')");
        expect(source).toContain('projectSharedGameForTeam(sharedGame, teamId)');

        const upcomingSource = getFunctionSource(source, 'getUpcomingLiveGames');
        expect(upcomingSource).toContain('getSharedHomepageGames');
        expect(upcomingSource).toContain('shouldIncludeTeamInLiveOrUpcoming');
        expect(upcomingSource).toContain('games.sort(compareGamesByDateAsc)');

        const liveSource = getFunctionSource(source, 'getLiveGamesNow');
        expect(liveSource).toContain('getSharedHomepageGames');
        expect(liveSource).toContain("where('liveStatus', '==', 'live')");
        expect(liveSource).toContain('shouldIncludeTeamInLiveOrUpcoming');

        const replaySource = getFunctionSource(source, 'getRecentLiveTrackedGames');
        expect(replaySource).toContain('getSharedHomepageGames(recentQueryConstraints, shouldIncludeTeamInReplay, limitCount)');
        expect(replaySource).toContain('games.sort(compareGamesByDateDesc)');
        expect(replaySource).toContain('return games.slice(0, limitCount)');
    });
});
