import { describe, expect, it } from 'vitest';
import { RosterTab } from './RosterTab';
import { loadRosterTab } from './rosterTabLoader';

describe('loadRosterTab', () => {
  it('resolves the roster component expected by the lazy boundary', async () => {
    await expect(loadRosterTab()).resolves.toEqual({ default: RosterTab });
  });
});
