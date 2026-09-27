import { describe, expect, it } from 'vitest';
import { MoreTab } from './MoreTab';
import { loadMoreTab } from './moreTabLoader';

describe('loadMoreTab', () => {
  it('resolves the more component expected by the lazy boundary', async () => {
    await expect(loadMoreTab()).resolves.toEqual({ default: MoreTab });
  });
});
