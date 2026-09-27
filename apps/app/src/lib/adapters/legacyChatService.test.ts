import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn()
}));

vi.mock('@legacy/db.js', () => ({}));
vi.mock('@legacy/firebase.js', () => ({
  functions: { name: 'functions' },
  httpsCallable: firebaseMocks.httpsCallable
}));
vi.mock('@legacy/vendor/firebase-app.js', () => ({ getApp: vi.fn() }));
vi.mock('@legacy/team-visibility.js', () => ({ isTeamActive: vi.fn() }));

import { sendTeamEmail } from './legacyChatService';

describe('legacyChatService team email callable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseMocks.callable.mockResolvedValue({ data: { recipientCount: 2, chatPostCreated: true } });
    firebaseMocks.httpsCallable.mockReturnValue(firebaseMocks.callable);
  });

  it('forwards the explicit cross-post flag to the backend callable', async () => {
    await expect(sendTeamEmail('team-1', {
      subject: 'Schedule change',
      body: 'Practice starts at six.',
      targetType: 'full_team',
      recipientIds: [],
      draftId: null,
      attachments: [],
      postToTeamChat: true
    })).resolves.toEqual({ recipientCount: 2, chatPostCreated: true });

    expect(firebaseMocks.callable).toHaveBeenCalledWith({
      teamId: 'team-1',
      subject: 'Schedule change',
      body: 'Practice starts at six.',
      targetType: 'full_team',
      recipientIds: [],
      draftId: null,
      attachments: [],
      postToTeamChat: true
    });
  });
});
