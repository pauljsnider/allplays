import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTrackLive() {
  return readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');
}

describe('track-live live event publishing', () => {
  it('publishes reverse stat events when stats are undone or corrected', () => {
    const source = readTrackLive();

    expect(source).toContain("type: 'undo'");
    expect(source).toContain("type: 'stat'");
    expect(source).toContain('let appliedDelta = 0;');
    expect(source).toContain('value: -appliedDelta');
    expect(source).toContain('value: -value');
    expect(source).toContain('description: `Undo stat: ${entry.text}`');
    expect(source).toContain('description: `Corrected stat: ${statKey.toUpperCase()} adjusted`');
  });

  it('wires bounded goal-sport controls into track-live', () => {
    const source = readTrackLive();

    expect(source).toContain('id="goal-sport-controls"');
    expect(source).toContain('id="goal-scorer-input"');
    expect(source).toContain('id="goal-note-input"');
    expect(source).toContain("getGoalSportProfile({ game: currentGame, team: currentTeam, config: currentConfig })");
    expect(source).toContain('hasExplicitStatTrackerConfig');
    expect(source).toContain("recordGoalSportGoal('home')");
    expect(source).toContain("recordGoalSportGoal('away')");
    expect(source).toContain("type: 'goal'");
    expect(source).toContain('statKey: event.statKey');
    expect(source).toContain('isOpponent: event.isOpponent');
    expect(source).toContain('buildGoalSportEvent({');
  });

  it('includes bounded football play logging with down-distance context', () => {
    const source = readTrackLive();

    expect(source).toContain('id="football-play-panel"');
    expect(source).toContain('data-football-play="rush"');
    expect(source).toContain('data-football-play="pass_complete"');
    expect(source).toContain('data-football-play="incomplete_pass"');
    expect(source).toContain('data-football-play="penalty"');
    expect(source).toContain('data-football-play="turnover"');
    expect(source).toContain('data-football-play="punt"');
    expect(source).toContain('data-football-play="kickoff"');
    expect(source).toContain("type: 'football_play'");
    expect(source).toContain('footballPlayType: playType');
    expect(source).toContain('liveFootballState: gameState.footballState');
    expect(source).toContain('scheduleFootballStateSync()');
    expect(source).toContain("genericPanels.classList.toggle('hidden', isGoalSportMode || gameState.isBaseballScorekeeping || volleyballMode || footballMode)");
    expect(source).toContain('possession: context.possession');
    expect(source).toContain('down: context.down');
    expect(source).toContain('distance: context.distance');
    expect(source).toContain('yardLine: context.yardLine');

  });
});
