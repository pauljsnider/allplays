import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn()
}));

vi.mock('./adapters/legacyAccountDb', () => ({
  functions: { name: 'functions' },
  httpsCallable: mocks.httpsCallable
}));

import { requestAccountDeletion } from './accountDeletionService';

describe('accountDeletionService', () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.httpsCallable.mockReset();
    mocks.httpsCallable.mockReturnValue(mocks.callable);
  });

  it('sends an explicit permanent deletion confirmation', async () => {
    mocks.callable.mockResolvedValue({ data: { success: true, status: 'queued', completionTargetDays: 30 } });
    await expect(requestAccountDeletion('ios')).resolves.toEqual({
      success: true,
      status: 'queued',
      completionTargetDays: 30
    });
    expect(mocks.httpsCallable).toHaveBeenCalledWith({ name: 'functions' }, 'requestAccountDeletion');
    expect(mocks.callable).toHaveBeenCalledWith({ confirmation: 'DELETE', source: 'ios' });
  });
});
