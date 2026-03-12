import { describe, expect, it } from 'vitest';
import {
  shouldMirrorSharedGame,
  createSharedScheduleId,
  buildMirroredGamePayload,
  buildSharedScheduleSourceUpdate,
  buildSharedScheduleDetachUpdate
} from '../../js/shared-schedule-sync.js';

describe('shared schedule sync helpers', () => {
  it('keeps placeholder tournament fixtures local until a real opponent team is linked', () => {
    expect(shouldMirrorSharedGame({
      type: 'game',
      competitionType: 'tournament',
      opponent: 'Winner SF1',
      opponentTeamId: null
    })).toBe(false);
  });

  it('creates stable shared schedule ids from team and game ids', () => {
    expect(createSharedScheduleId('team_alpha', 'game_123')).toBe('shared_team_alpha_game_123');
  });

  it('builds a mirrored opponent-team fixture with swapped perspective', () => {
    const tournament = {
      bracketName: 'Spring Cup',
      roundName: 'Semifinal',
      slotAssignments: {
        home: { sourceType: 'team', teamName: 'Alpha FC' },
        away: { sourceType: 'team', teamName: 'Bravo FC' }
      },
      resolved: {
        homeLabel: 'Alpha FC',
        awayLabel: 'Bravo FC',
        matchupLabel: 'Alpha FC vs Bravo FC',
        ready: true
      }
    };
    const payload = buildMirroredGamePayload({
      sourceTeamId: 'team-alpha',
      sourceTeam: {
        id: 'team-alpha',
        name: 'Alpha FC',
        photoUrl: 'https://example.com/alpha.png'
      },
      sourceGameId: 'game-123',
      sourceGame: {
        type: 'game',
        date: '2026-03-12T18:00:00Z',
        opponent: 'Winner SF1',
        opponentTeamId: 'team-bravo',
        opponentTeamName: 'Bravo FC',
        opponentTeamPhoto: 'https://example.com/bravo.png',
        location: 'Field 2',
        isHome: true,
        homeScore: 3,
        awayScore: 1,
        status: 'completed',
        competitionType: 'tournament',
        seasonLabel: '2026 Spring',
        countsTowardSeasonRecord: false,
        notes: 'Championship',
        arrivalTime: '2026-03-12T17:15:00Z',
        assignments: [{ role: 'Clock', value: 'Alex' }],
        statTrackerConfigId: 'cfg-1',
        tournament
      },
      sharedScheduleId: 'shared_team-alpha_game-123'
    });

    expect(payload).toMatchObject({
      type: 'game',
      opponent: 'Alpha FC',
      opponentTeamId: 'team-alpha',
      opponentTeamName: 'Alpha FC',
      opponentTeamPhoto: 'https://example.com/alpha.png',
      isHome: false,
      homeScore: 1,
      awayScore: 3,
      status: 'completed',
      competitionType: 'tournament',
      seasonLabel: '2026 Spring',
      countsTowardSeasonRecord: false,
      sharedScheduleId: 'shared_team-alpha_game-123',
      sharedScheduleSourceTeamId: 'team-alpha',
      sharedScheduleOpponentTeamId: 'team-alpha'
    });
    expect(payload.assignments).toEqual([{ role: 'Clock', value: 'Alex' }]);
    expect(payload.date).toBe('2026-03-12T18:00:00Z');
    expect(payload.arrivalTime).toBe('2026-03-12T17:15:00Z');
    expect(payload.tournament).toEqual(tournament);
    expect(payload.tournament).not.toBe(tournament);
    expect(payload.tournament.slotAssignments).not.toBe(tournament.slotAssignments);
    expect(payload.tournament.resolved).not.toBe(tournament.resolved);
  });

  it('records source metadata needed to keep the counterpart game in sync', () => {
    expect(buildSharedScheduleSourceUpdate({
      sharedScheduleId: 'shared_team-alpha_game-123',
      counterpartTeamId: 'team-bravo',
      counterpartGameId: 'game-999'
    })).toEqual({
      sharedScheduleId: 'shared_team-alpha_game-123',
      sharedScheduleOpponentTeamId: 'team-bravo',
      sharedScheduleOpponentGameId: 'game-999'
    });
  });

  it('clears counterpart sync metadata when a linked opponent is removed', () => {
    expect(buildSharedScheduleDetachUpdate()).toEqual({
      sharedScheduleId: null,
      sharedScheduleOpponentTeamId: null,
      sharedScheduleOpponentGameId: null
    });
  });
});
