import { describe, expect, it } from 'vitest';
import {
    buildSharedGameSyntheticId,
    decodeSharedGameSyntheticId,
    mergeGamesForTeam,
    projectSharedGameForTeam
} from '../../js/shared-games.js';

describe('shared game projection', () => {
    it('builds delimiter-safe synthetic ids and still decodes legacy ids', () => {
        const sharedPath = 'organizations/org-9/sharedGames/game-legacy';
        const syntheticId = buildSharedGameSyntheticId(sharedPath);

        expect(syntheticId).toBe('shared_organizations%2Forg-9%2FsharedGames%2Fgame-legacy');
        expect(syntheticId.includes('::')).toBe(false);
        expect(decodeSharedGameSyntheticId(syntheticId)).toBe(sharedPath);
        expect(decodeSharedGameSyntheticId(`shared::${encodeURIComponent(sharedPath)}`)).toBe(sharedPath);
    });

    it('projects a centrally owned shared game into the home team schedule', () => {
        const shared = {
            id: 'game-100',
            _sharedGamePath: 'organizations/org-9/sharedGames/game-100',
            tournamentId: 'tour-55',
            date: '2026-07-04T15:00:00.000Z',
            location: 'Center Court',
            competitionType: 'tournament',
            homeTeamId: 'team-home',
            homeTeamName: 'Falcons',
            awayTeamId: 'team-away',
            awayTeamName: 'Wolves'
        };

        const projected = projectSharedGameForTeam(shared, 'team-home');

        expect(projected).toMatchObject({
            id: buildSharedGameSyntheticId(shared._sharedGamePath),
            sharedGameId: 'game-100',
            tournamentId: 'tour-55',
            teamId: 'team-home',
            opponent: 'Wolves',
            opponentTeamId: 'team-away',
            opponentTeamName: 'Wolves',
            isHome: true,
            competitionType: 'tournament',
            type: 'game',
            isSharedGame: true
        });
        expect(decodeSharedGameSyntheticId(projected.id)).toBe(shared._sharedGamePath);
    });

    it('projects placeholder entrants as TBD opponents until slots are assigned', () => {
        const shared = {
            id: 'game-200',
            _sharedGamePath: 'tournaments/tour-22/sharedGames/game-200',
            date: '2026-07-05T12:00:00.000Z',
            homeTeamId: 'team-home',
            homeTeamName: 'Falcons',
            awayPlaceholderName: 'TBD semifinal winner'
        };

        const projected = projectSharedGameForTeam(shared, 'team-home');

        expect(projected.opponent).toBe('TBD semifinal winner');
        expect(projected.opponentTeamId).toBeNull();
        expect(projected.opponentTeamName).toBe('TBD semifinal winner');
    });

    it('merges projected shared games into the team schedule without duplicating shared ids', () => {
        const sharedPath = 'organizations/org-9/sharedGames/game-300';
        const localGames = [
            { id: 'local-1', opponent: 'Knights', date: '2026-06-01T10:00:00.000Z' },
            { id: 'mirror-copy', sharedGameId: 'game-300', opponent: 'Old duplicate', date: '2026-06-02T10:00:00.000Z' }
        ];
        const sharedGames = [
            {
                id: 'game-300',
                _sharedGamePath: sharedPath,
                date: '2026-06-02T10:00:00.000Z',
                homeTeamId: 'team-home',
                homeTeamName: 'Falcons',
                awayTeamId: 'team-away',
                awayTeamName: 'Titans'
            }
        ];

        const merged = mergeGamesForTeam(localGames, sharedGames, 'team-home');

        expect(merged.map((game) => game.id)).toEqual([
            'local-1',
            buildSharedGameSyntheticId(sharedPath)
        ]);
        expect(merged[1]).toMatchObject({
            sharedGameId: 'game-300',
            opponent: 'Titans',
            isSharedGame: true
        });
    });
});
