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

    it('ranks only complete Diamond values and discloses projection state', () => {
        const source = readTeamHtml();

        expect(source).toContain("from './js/diamond-stat-presentation.js?v=1'");
        expect(source).toContain('if (!isDiamondV2Game(game)) return loadAggregatedStatsForGame(game);');
        expect(source).toContain('const completeStatsByPlayerId = coverageAwareSeason.completeStatsByPlayerId;');
        expect(source).toContain('Object.prototype.hasOwnProperty.call(completeStatsByPlayerId[player.id] || {}, definition.id)');
        expect(source).toContain('Diamond scorebook stats · Read only');
        expect(source).toContain('Missing or partially captured stats are not treated as zero.');
        expect(source).toContain('data-diamond-stats-status');
    });
});
