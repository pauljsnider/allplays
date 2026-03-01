import { describe, it, expect } from 'vitest';
import { hydrateOpponentStats } from '../../js/live-tracker-opponent-stats.js';

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
});
