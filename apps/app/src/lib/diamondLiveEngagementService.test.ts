import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
  functions: { name: 'functions' },
  httpsCallable: vi.fn(),
  subscribeDiamondLiveChat: vi.fn(() => vi.fn()),
  subscribeDiamondLiveReactions: vi.fn(() => vi.fn()),
}));
const nativeMocks = vi.hoisted(() => ({
  callNativeFirebaseFunction: vi.fn(),
  isNativeRuntime: vi.fn(() => false),
}));

vi.mock('./adapters/legacyDiamondLiveEngagement', () => adapterMocks);
vi.mock('./nativeCallable', () => ({
  callNativeFirebaseFunction: nativeMocks.callNativeFirebaseFunction,
}));
vi.mock('./nativeRuntime', () => ({
  isNativeRuntime: nativeMocks.isNativeRuntime,
}));

import {
  createDiamondLiveEngagementRequestId,
  moderateDiamondLiveChat,
  postDiamondLiveChat,
  postDiamondLiveReaction,
} from './diamondLiveEngagementService';

const identity = {
  teamId: 'team-1',
  gameId: 'game-1',
  instanceId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
};

describe('diamondLiveEngagementService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeMocks.isNativeRuntime.mockReturnValue(false);
  });

  it('uses the exact web callable contract and validates the bound response', async () => {
    const chatCallable = vi.fn().mockResolvedValue({ data: {
      outcome: 'accepted',
      requestId: identity.requestId,
      instanceId: identity.instanceId,
      messageId: 'diamond-chat-1',
    } });
    const reactionCallable = vi.fn().mockResolvedValue({ data: {
      outcome: 'accepted',
      requestId: identity.requestId,
      instanceId: identity.instanceId,
      reactionId: 'diamond-reaction-1',
    } });
    adapterMocks.httpsCallable.mockImplementation((_functions, name) => (
      name === 'postDiamondLiveChat' ? chatCallable : reactionCallable
    ));

    await expect(postDiamondLiveChat(identity, '  Great   play  ')).resolves.toMatchObject({
      messageId: 'diamond-chat-1',
    });
    expect(chatCallable).toHaveBeenCalledWith({
      schemaVersion: 1,
      requestId: identity.requestId,
      teamId: identity.teamId,
      gameId: identity.gameId,
      expectedInstanceId: identity.instanceId,
      viewerMode: 'live',
      text: 'Great play',
    });

    await expect(postDiamondLiveReaction(identity, 'heart')).resolves.toMatchObject({
      reactionId: 'diamond-reaction-1',
    });
    expect(reactionCallable).toHaveBeenCalledWith({
      schemaVersion: 1,
      requestId: identity.requestId,
      teamId: identity.teamId,
      gameId: identity.gameId,
      expectedInstanceId: identity.instanceId,
      viewerMode: 'live',
      type: 'heart',
    });
  });

  it('uses the native callable bridge and rejects an unbound response', async () => {
    nativeMocks.isNativeRuntime.mockReturnValue(true);
    nativeMocks.callNativeFirebaseFunction.mockResolvedValue({
      outcome: 'accepted',
      requestId: identity.requestId,
      instanceId: '00000000-0000-4000-8000-000000000099',
      messageId: 'wrong-generation',
    });
    await expect(postDiamondLiveChat(identity, 'Great play')).rejects.toThrow(
      'did not confirm',
    );
    expect(nativeMocks.callNativeFirebaseFunction).toHaveBeenCalledWith(
      'postDiamondLiveChat',
      expect.objectContaining({ expectedInstanceId: identity.instanceId }),
      { errorLabel: 'Diamond live engagement' },
    );
    expect(adapterMocks.httpsCallable).not.toHaveBeenCalled();
  });

  it('uses the exact manager moderation contract and requires a bound removal receipt', async () => {
    const messageId = `diamond-chat-${'a'.repeat(64)}`;
    const callable = vi.fn().mockResolvedValue({ data: {
      outcome: 'accepted',
      requestId: identity.requestId,
      instanceId: identity.instanceId,
      messageId,
      removed: true,
    } });
    adapterMocks.httpsCallable.mockReturnValue(callable);

    await expect(moderateDiamondLiveChat(identity, messageId)).resolves.toMatchObject({
      messageId,
      removed: true,
    });
    expect(adapterMocks.httpsCallable).toHaveBeenCalledWith(
      adapterMocks.functions,
      'moderateDiamondLiveChat',
    );
    expect(callable).toHaveBeenCalledWith({
      schemaVersion: 1,
      requestId: identity.requestId,
      teamId: identity.teamId,
      gameId: identity.gameId,
      expectedInstanceId: identity.instanceId,
      messageId,
    });
  });

  it('requires secure randomness and never falls back to Math.random', () => {
    expect(createDiamondLiveEngagementRequestId({
      randomUUID: () => '00000000-0000-4000-8000-000000000123',
      getRandomValues: vi.fn(),
    } as unknown as Crypto)).toBe('00000000-0000-4000-8000-000000000123');
    expect(() => createDiamondLiveEngagementRequestId(null)).toThrow(
      'Secure live-interaction identity is unavailable',
    );
  });
});
