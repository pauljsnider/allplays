import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyGoalSportScore, buildGoalSportEvent, resolveGoalSportScorer } from '../../js/live-scorekeeping-goal-sports.js';

describe('goal sport scorekeeping helpers', () => {
  it('increments the selected side by one goal', () => {
    expect(applyGoalSportScore({ homeScore: 1, awayScore: 2 }, 'home')).toEqual({
      homeScore: 2,
      awayScore: 2
    });
    expect(applyGoalSportScore({ homeScore: 1, awayScore: 2 }, 'away')).toEqual({
      homeScore: 1,
      awayScore: 3
    });
  });

  it('builds fan-visible goal events with period, side, scorer, and note', () => {
    const event = buildGoalSportEvent({
      teamSide: 'away',
      period: 'H2',
      scorer: 'Alex Kim',
      note: 'Header off corner',
      gameClockMs: 125000,
      homeScore: 1,
      awayScore: 2,
      createdBy: 'user-1',
      player: { id: 'opp-7', name: 'Alex Kim', number: '11' }
    });

    expect(event).toMatchObject({
      type: 'goal',
      statKey: 'goals',
      value: 1,
      teamSide: 'away',
      isOpponent: true,
      period: 'H2',
      scorer: 'Alex Kim',
      note: 'Header off corner',
      playerId: 'opp-7',
      playerName: null,
      playerNumber: '',
      opponentPlayerName: 'Alex Kim',
      opponentPlayerNumber: '11',
      homeScore: 1,
      awayScore: 2,
      createdBy: 'user-1'
    });
    expect(event.description).toBe('Away goal by Alex Kim (H2) — Header off corner');
  });

  it('updates scorer player stats when recording a simple goal sport goal', () => {
    const html = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');

    expect(html).toContain('resolveGoalSportScorer');
    expect(html).toContain('applyRecordedGoalSportScorerStat(teamSide, scorerPlayer);');
    expect(html).toContain('gameState.playerStats');
    expect(html).toContain('schedulePlayerStatsSync(scorerPlayer.id);');
    expect(html).toContain('scheduleOpponentStatsSync();');
    expect(html).toContain('player: scorerPlayer');
  });

  it('validates scorer text before mutating score state', () => {
    const html = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');

    const validationIndex = html.indexOf('const scorerPlayer = resolveGoalSportScorerForSide(teamSide, scorer);');
    const scoreMutationIndex = html.indexOf('const nextScore = applyGoalSportScore({ homeScore, awayScore }, teamSide);');

    expect(validationIndex).toBeGreaterThan(-1);
    expect(scoreMutationIndex).toBeGreaterThan(-1);
    expect(validationIndex).toBeLessThan(scoreMutationIndex);
    expect(html).toContain('if (scorer.trim() && !scorerPlayer)');
    expect(html).toContain('leave scorer blank for a team goal');
    expect(html).toContain('scorerInput?.focus();');
  });

  it('rolls back scorer stats when undoing a goal entry', () => {
    const html = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');

    expect(html).toContain("if (undoData && undoData.type === 'goal')");
    expect(html).toContain('const statKey = undoData.statKey || getGoalSportStatKey();');
    expect(html).toContain('if (undoData.playerId)');
    expect(html).toContain('statsBucket[undoData.playerId][statKey] = newVal;');
    expect(html).toContain('schedulePlayerStatsSync(undoData.playerId);');
    expect(html).toContain('broadcastReversedStatEvent({');
    expect(html).toContain('description: `Undo stat: ${entry.text}`');
  });

  it('resolves scorer text to roster players by name or jersey number', () => {
    const players = [
      { id: 'p1', name: 'Alex Kim', number: '8' },
      { id: 'p2', name: 'Sam Rivera', number: '11' }
    ];

    expect(resolveGoalSportScorer(players, ' alex   kim ')?.id).toBe('p1');
    expect(resolveGoalSportScorer(players, '#11')?.id).toBe('p2');
    expect(resolveGoalSportScorer(players, 'Unknown')).toBeNull();
  });

  it('keeps away opponent jersey numbers in the live scorer lookup pool', () => {
    const html = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');

    expect(resolveGoalSportScorer([
      { id: 'opp1', name: 'Rival Forward', number: '11' }
    ], '#11')?.id).toBe('opp1');
    expect(html).toContain("{ id: 'opp1', name: '', number: '' }");
    expect(html).toContain('number: data?.number || data?.playerNumber || data?.jerseyNumber ||');
    expect(html).toContain('number: opp.number || existing.number ||');
    expect(html).toContain('id="goal-sport-away-roster"');
    expect(html).toContain('renderGoalSportAwayRoster();');
    expect(html).toContain('aria-label="Away player ${index + 1} jersey number"');
    expect(html).toContain('onchange="updateOpponentNumber');
    expect(html).toContain('window.updateOpponentNumber = function (oppId, number)');
    expect(html).toContain("replace(/^#/, '')");
  });
});
