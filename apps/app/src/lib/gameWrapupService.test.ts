import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  getTeam: vi.fn(),
  getGame: vi.fn(),
  getConfigs: vi.fn(),
  getGameEvents: vi.fn()
}));

const aiMocks = vi.hoisted(() => {
  const generateContent = vi.fn();
  const getGenerativeModel = vi.fn(() => ({ generateContent }));
  return {
    generateContent,
    getGenerativeModel
  };
});

const gameReportMocks = vi.hoisted(() => ({
  loadGameReportPlays: vi.fn()
}));

vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/vendor/firebase-app.js', () => ({
  getApp: vi.fn(() => ({}))
}));
vi.mock('../../../../js/vendor/firebase-ai.js', () => ({
  getAI: vi.fn(() => ({})),
  getGenerativeModel: aiMocks.getGenerativeModel,
  GoogleAIBackend: vi.fn()
}));
vi.mock('../../../../js/live-game-state.js', () => ({
  resolveLiveStatConfig: vi.fn(({ team, game }) => ({ sport: game?.sport || team?.sport || 'Basketball' }))
}));
vi.mock('./gameReportService', () => gameReportMocks);

import { buildFinishGamePayload, buildGameSummaryPrompt, buildPracticeFeedPrompt } from '../../../../js/game-day-wrapup.js';
import {
  buildAppWrapupCompletionPayload,
  buildGameWrapupEmailDraft,
  generateGameWrapupArtifactsForApp,
  resetGameWrapupAiModel
} from './gameWrapupService';

describe('gameWrapupService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGameWrapupAiModel();
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Falcons', sport: 'Basketball' });
    dbMocks.getGame.mockResolvedValue({
      id: 'game-1',
      opponent: 'Tigers',
      coachingNotes: [{ text: 'Own the glass.' }],
      sport: 'Basketball'
    });
    dbMocks.getConfigs.mockResolvedValue([]);
    dbMocks.getGameEvents.mockResolvedValue([
      { playerName: 'Ava', stat: '3PT Made', timestamp: new Date('2026-06-10T18:00:00Z') },
      { playerName: 'Blair', type: 'Steal', timestamp: new Date('2026-06-10T18:01:00Z') }
    ]);
    gameReportMocks.loadGameReportPlays.mockReset();
  });

  it('matches the legacy finish payload shape', () => {
    expect(buildAppWrapupCompletionPayload({
      homeScore: 5,
      awayScore: 3,
      postGameNotes: '  Great defensive shape.  '
    })).toEqual(buildFinishGamePayload({
      homeScoreValue: '5',
      awayScoreValue: '3',
      postGameNotesValue: '  Great defensive shape.  '
    }));
  });

  it('builds a mailto recap using the legacy recipient fallback', () => {
    expect(buildGameWrapupEmailDraft({
      teamName: 'Falcons',
      opponentName: 'Tigers',
      gameDate: new Date('2026-06-10T18:00:00Z'),
      score: { home: 48, away: 42 },
      summary: 'Falcons controlled the glass late.',
      postGameNotes: 'Bench energy changed the game.',
      teamNotificationEmail: 'staff@example.com',
      userEmail: 'coach@example.com'
    })).toMatchObject({
      recipientEmail: 'staff@example.com',
      subject: 'Falcons vs Tigers - Game Summary'
    });

    const fallbackDraft = buildGameWrapupEmailDraft({
      teamName: 'Falcons',
      opponentName: 'Tigers',
      gameDate: new Date('2026-06-10T18:00:00Z'),
      score: { home: 48, away: 42 },
      summary: 'Falcons controlled the glass late.',
      postGameNotes: 'Bench energy changed the game.',
      userEmail: 'coach@example.com'
    });

    expect(fallbackDraft).toMatchObject({
      recipientEmail: 'coach@example.com',
      subject: 'Falcons vs Tigers - Game Summary'
    });
    expect(fallbackDraft?.body).toContain('Final Score: 48 - 42');
    expect(fallbackDraft?.body).toContain('SUMMARY:');
    expect(fallbackDraft?.body).toContain('POST-GAME NOTES:');
    expect(fallbackDraft?.mailto).toContain('mailto:coach@example.com?subject=');
  });

  it('assembles the same legacy prompts and returns persisted artifacts', async () => {
    aiMocks.generateContent
      .mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({
            practiceFeedItems: [{ weakness: 'Closeouts', evidence: 'Late rotations', drillCategory: 'Defense', urgency: 'high' }]
          })
        }
      })
      .mockResolvedValueOnce({
        response: {
          text: () => 'Falcons stayed poised late and finished through contact.'
        }
      });

    const result = await generateGameWrapupArtifactsForApp({
      teamId: 'team-1',
      gameId: 'game-1',
      score: { home: 48, away: 42 },
      notes: 'Bench energy changed the game.'
    });

    const expectedPracticeFeedPrompt = buildPracticeFeedPrompt({
      game: await dbMocks.getGame.mock.results[0].value,
      team: await dbMocks.getTeam.mock.results[0].value,
      config: { sport: 'Basketball' },
      score: { home: 48, away: 42 },
      coachingNotes: [{ text: 'Own the glass.' }],
      notes: 'Bench energy changed the game.',
      events: [
        { playerName: 'Ava', stat: '3PT Made', timestamp: new Date('2026-06-10T18:00:00Z'), clock: '' },
        { playerName: 'Blair', type: 'Steal', timestamp: new Date('2026-06-10T18:01:00Z'), clock: '' }
      ]
    });
    const expectedSummaryPrompt = buildGameSummaryPrompt({
      game: await dbMocks.getGame.mock.results[0].value,
      team: await dbMocks.getTeam.mock.results[0].value,
      config: { sport: 'Basketball' },
      score: { home: 48, away: 42 },
      coachingNotes: [{ text: 'Own the glass.' }],
      notes: 'Bench energy changed the game.'
    });

    expect(aiMocks.generateContent).toHaveBeenNthCalledWith(1, expectedPracticeFeedPrompt);
    expect(aiMocks.generateContent).toHaveBeenNthCalledWith(2, expectedSummaryPrompt);
    expect(result.summary).toBe('Falcons stayed poised late and finished through contact.');
    expect(result.practiceFeedItems).toHaveLength(1);
    expect(result.practiceFeedItems[0]).toMatchObject({
      weakness: 'Closeouts',
      evidence: 'Late rotations',
      drillCategory: 'Defense',
      urgency: 'high'
    });
    expect(result.practiceFeedItems[0].addedAt).toMatch(/T/);
    expect(dbMocks.getGameEvents).toHaveBeenCalledWith('team-1', 'game-1', { limit: 100 });
    expect(gameReportMocks.loadGameReportPlays).not.toHaveBeenCalled();
  });

  it('retries one incomplete Diamond replay and uses only its sanitized play descriptions', async () => {
    const diamondGame = {
      id: 'game-1',
      opponent: 'Tigers',
      coachingNotes: [],
      sport: 'Baseball',
      trackingEngine: 'diamond-v2',
      diamondScorebookInstanceId: '11111111-1111-4111-8111-111111111111',
      diamondProjectionRevision: 7
    };
    dbMocks.getGame.mockResolvedValue(diamondGame);
    gameReportMocks.loadGameReportPlays
      .mockResolvedValueOnce({
        game: diamondGame,
        plays: [],
        playsFresh: false,
        replayError: 'Retry the report.'
      })
      .mockResolvedValueOnce({
        game: diamondGame,
        plays: [{
          id: 'play-7',
          text: 'Plate appearance: single',
          period: 'Bottom 4',
          clock: '',
          timestamp: new Date('2026-06-10T18:01:00Z')
        }],
        playsFresh: true,
        replay: {
          requestedVisibility: 'manager-internal',
          visibility: 'public',
          source: 'public-sanitized'
        }
      });
    aiMocks.generateContent
      .mockResolvedValueOnce({ response: { text: () => '{"practiceFeedItems":[]}' } })
      .mockResolvedValueOnce({ response: { text: () => 'Falcons rallied late.' } });

    await generateGameWrapupArtifactsForApp({
      teamId: 'team-1',
      gameId: 'game-1',
      score: { home: 5, away: 3 },
      notes: ''
    });

    expect(gameReportMocks.loadGameReportPlays).toHaveBeenCalledTimes(2);
    expect(gameReportMocks.loadGameReportPlays).toHaveBeenNthCalledWith(1, 'team-1', 'game-1', {
      statVisibility: 'manager-internal'
    });
    expect(dbMocks.getGameEvents).not.toHaveBeenCalled();
    expect(aiMocks.generateContent.mock.calls[0]?.[0]).toContain('Key events: Plate appearance: single');
  });

  it('does not call the model when a Diamond replay remains incomplete after one retry', async () => {
    const diamondGame = {
      id: 'game-1',
      sport: 'Baseball',
      trackingEngine: 'diamond-v2',
      diamondScorebookInstanceId: '11111111-1111-4111-8111-111111111111',
      diamondProjectionRevision: 7
    };
    dbMocks.getGame.mockResolvedValue(diamondGame);
    gameReportMocks.loadGameReportPlays.mockResolvedValue({
      game: diamondGame,
      plays: [],
      playsFresh: false,
      replayError: 'Retry the report.'
    });

    await expect(generateGameWrapupArtifactsForApp({
      teamId: 'team-1',
      gameId: 'game-1',
      score: { home: 5, away: 3 },
      notes: ''
    })).rejects.toThrow('Diamond play-by-play could not be loaded completely. Try wrap-up again.');

    expect(gameReportMocks.loadGameReportPlays).toHaveBeenCalledTimes(2);
    expect(dbMocks.getGameEvents).not.toHaveBeenCalled();
    expect(aiMocks.getGenerativeModel).not.toHaveBeenCalled();
    expect(aiMocks.generateContent).not.toHaveBeenCalled();
  });

  it('does not accept a complete replay from a replaced Diamond scorebook instance', async () => {
    const diamondGame = {
      id: 'game-1',
      sport: 'Baseball',
      trackingEngine: 'diamond-v2',
      diamondScorebookInstanceId: '11111111-1111-4111-8111-111111111111',
      diamondProjectionRevision: 7
    };
    dbMocks.getGame.mockResolvedValue(diamondGame);
    gameReportMocks.loadGameReportPlays.mockResolvedValue({
      game: {
        ...diamondGame,
        diamondScorebookInstanceId: '22222222-2222-4222-8222-222222222222'
      },
      plays: [{
        id: 'stale-play-7',
        text: 'Plate appearance: home run',
        period: 'Bottom 4',
        clock: '',
        timestamp: new Date('2026-06-10T18:01:00Z')
      }],
      playsFresh: true,
      replay: {
        requestedVisibility: 'manager-internal',
        visibility: 'public',
        source: 'public-sanitized'
      }
    });

    await expect(generateGameWrapupArtifactsForApp({
      teamId: 'team-1',
      gameId: 'game-1',
      score: { home: 5, away: 3 },
      notes: ''
    })).rejects.toThrow('Diamond play-by-play could not be loaded completely. Try wrap-up again.');

    expect(gameReportMocks.loadGameReportPlays).toHaveBeenCalledTimes(2);
    expect(aiMocks.getGenerativeModel).not.toHaveBeenCalled();
    expect(aiMocks.generateContent).not.toHaveBeenCalled();
  });

  it('allows a complete empty Diamond replay as authoritative absence', async () => {
    const diamondGame = {
      id: 'game-1',
      sport: 'Baseball',
      trackingEngine: 'diamond-v2',
      diamondScorebookInstanceId: '11111111-1111-4111-8111-111111111111',
      diamondProjectionRevision: 1
    };
    dbMocks.getGame.mockResolvedValue(diamondGame);
    gameReportMocks.loadGameReportPlays.mockResolvedValue({
      game: diamondGame,
      plays: [],
      playsFresh: true,
      replay: {
        requestedVisibility: 'manager-internal',
        visibility: 'manager-internal',
        source: 'manager-private-sanitized'
      }
    });
    aiMocks.generateContent
      .mockResolvedValueOnce({ response: { text: () => '{"practiceFeedItems":[]}' } })
      .mockResolvedValueOnce({ response: { text: () => 'A complete summary.' } });

    await generateGameWrapupArtifactsForApp({
      teamId: 'team-1',
      gameId: 'game-1',
      score: { home: 0, away: 0 },
      notes: ''
    });

    expect(gameReportMocks.loadGameReportPlays).toHaveBeenCalledTimes(1);
    expect(aiMocks.generateContent.mock.calls[0]?.[0]).toContain('Key events: None');
  });
});
