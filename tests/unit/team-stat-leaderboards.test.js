import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readTeamHtml() {
    return readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
}

describe('team stat leaderboard season wiring', () => {
    it('rebuilds configured stat leaderboards when the season selector changes', () => {
        const source = readTeamHtml();

        expect(source).toContain('aggregateSeasonStatsByPlayerId');
        expect(source).toContain('seasonFilterEl.addEventListener(\'change\', async () =>');
        expect(source).toContain('const updatedLeaderboardSnapshot = await buildLeaderboardSnapshotForSeason(seasonFilterLabel);');
        expect(source).toContain('updateConfiguredTeamLeaderboardSection(updatedLeaderboardSnapshot, teamId);');
        expect(source).toContain('id="configured-team-leaderboards-section"');
    });
});
