import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeNativeStandings } from '../../js/native-standings.js';

function readTeamPage() {
    return readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
}

function extractBuildNativeStandingsSnapshotBody() {
    const source = readTeamPage();
    const match = source.match(/function buildNativeStandingsSnapshot\(team, dbGames\) \{([\s\S]*?)\n        \}\n\n        function renderNativeStandingsOverviewBody/);
    expect(match, 'buildNativeStandingsSnapshot should exist').toBeTruthy();
    return match[1];
}

function buildNativeStandingsSnapshot(team, dbGames) {
    const body = extractBuildNativeStandingsSnapshotBody();
    const createBuilder = new Function('computeNativeStandings', `
        return function(team, dbGames) {
${body}
        };
    `);

    return createBuilder(computeNativeStandings)(team, dbGames);
}

describe('team page native standings snapshot', () => {
    it('maps away game scores from our-team fields to actual home and away teams', () => {
        const snapshot = buildNativeStandingsSnapshot({
            name: 'Falcons',
            standingsConfig: {
                enabled: true,
                rankingMode: 'points',
                points: { win: 3, tie: 1, loss: 0 }
            }
        }, [
            {
                type: 'game',
                opponent: 'Wolves',
                isHome: false,
                homeScore: 3,
                awayScore: 1,
                status: 'completed'
            }
        ]);

        expect(snapshot.match).toMatchObject({
            team: 'Falcons',
            record: '1-0',
            pf: 3,
            pa: 1,
            points: 3
        });
        expect(snapshot.rows.find((row) => row.team === 'Wolves')).toMatchObject({
            record: '0-1',
            pf: 1,
            pa: 3,
            points: 0
        });
    });
});
