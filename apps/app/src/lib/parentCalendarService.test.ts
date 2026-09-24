// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const parentToolsAdapterMocks = vi.hoisted(() => ({
  functions: { name: 'mock-functions' },
  httpsCallable: vi.fn()
}));

vi.mock('./adapters/legacyParentTools', () => parentToolsAdapterMocks);
vi.mock('./homeService', () => ({ loadParentScheduleSummary: vi.fn() }));

import { getPrivateTeamCalendarFeedUrl } from './parentCalendarService';

beforeEach(() => {
  vi.clearAllMocks();
  parentToolsAdapterMocks.httpsCallable.mockReturnValue(vi.fn().mockRejectedValue(new Error('permission-denied')));
  delete (globalThis as any).__ALLPLAYS_CONFIG__;
  delete (globalThis as any).ALLPLAYS_CALENDAR_FUNCTION_URL;
  delete (globalThis as any).ALLPLAYS_TEAM_CALENDAR_FEED_URL;
});

describe('parent calendar private feed resolution', () => {
  it('builds the packaged-app URL only from a server-provisioned token', async () => {
    parentToolsAdapterMocks.httpsCallable.mockReturnValue(
      vi.fn().mockResolvedValue({ data: { teamId: 'team-1', token: 'server-token', reused: false } })
    );

    await expect(getPrivateTeamCalendarFeedUrl('team-1')).resolves.toBe(
      'https://us-central1-game-flow-c6311.cloudfunctions.net/teamCalendarFeed?teamId=team-1&token=server-token'
    );
  });

  it('fails closed when the callable denies provisioning', async () => {
    await expect(getPrivateTeamCalendarFeedUrl('team-1')).resolves.toBe('');
  });
});
