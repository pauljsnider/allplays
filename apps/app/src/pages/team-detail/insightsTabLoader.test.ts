import { describe, expect, it } from 'vitest';
import { InsightsTab } from './InsightsTab';
import { loadInsightsTab } from './insightsTabLoader';

describe('loadInsightsTab', () => {
  it('resolves the insights component expected by the lazy boundary', async () => {
    await expect(loadInsightsTab()).resolves.toEqual({ default: InsightsTab });
  });
});
