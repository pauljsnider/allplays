import { describe, it, expect } from 'vitest';
import { buildOpponentStatDefaults, hydrateOpponentStats } from '../../js/live-tracker-opponent-stats.js';

describe('live tracker opponent stats hydration', () => {
  it('preserves persisted fouls when resuming opponent stats', () => {
    const hydrated = hydrateOpponentStats({ pts: 8, ast: 2, fouls: 3 }, ['PTS', 'AST']);
    expect(hydrated.pts).toBe(8);
    expect(hydrated.ast).toBe(2);
    expect(hydrated.fouls).toBe(3);
  });

  it('defaults fouls to zero when persisted fouls are missing', () => {
    const hydrated = hydrateOpponentStats({ pts: 4 }, ['PTS']);
    expect(hydrated.pts).toBe(4);
    expect(hydrated.fouls).toBe(0);
  });

  it('builds defaults with time and fouls even when columns are empty', () => {
    expect(buildOpponentStatDefaults([])).toEqual({ time: 0, fouls: 0 });
  });

  it('hydrates only declared columns and ignores unknown persisted keys', () => {
    const hydrated = hydrateOpponentStats({ pts: 10, blk: 6, fouls: 2 }, ['PTS']);
    expect(hydrated).toEqual({ time: 0, fouls: 2, pts: 10 });
    expect(hydrated.blk).toBeUndefined();
  });
});
