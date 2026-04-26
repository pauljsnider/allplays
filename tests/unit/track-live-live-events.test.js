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
    expect(source).toContain("recordGoalSportGoal('home')");
    expect(source).toContain("recordGoalSportGoal('away')");
    expect(source).toContain("type: 'goal'");
    expect(source).toContain('buildGoalSportEvent({');
  });
});
