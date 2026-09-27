import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpMocks = vi.hoisted(() => ({ post: vi.fn() }));
const legacyMocks = vi.hoisted(() => ({
  listParentTeamFeeRecipients: vi.fn()
}));
const authMocks = vi.hoisted(() => ({
  getNativeAuthIdToken: vi.fn(),
  firebaseAuth: {
    app: { options: { projectId: 'demo-project' } }
  }
}));
const appCheckMocks = vi.hoisted(() => ({
  getPrimaryAppCheckHeaders: vi.fn(async (headers: Record<string, string>) => ({
    ...headers,
    'X-Firebase-AppCheck': 'debug-app-check'
  }))
}));
const runtimeMocks = vi.hoisted(() => ({
  isNativeRuntime: vi.fn()
}));

vi.mock('@capacitor/core', () => ({ CapacitorHttp: { post: httpMocks.post } }));
vi.mock('./adapters/legacyHomeFees', () => legacyMocks);
vi.mock('./adapters/legacyFirebaseAppCheck', () => appCheckMocks);
vi.mock('./authService', () => authMocks);
vi.mock('./nativeRuntime', () => runtimeMocks);

import { listParentTeamFeeRecipientsForApp } from './parentFeeRecipientsService';

const childLinks = [{ teamId: 'team-1', playerId: 'player-1' }];

describe('parentFeeRecipientsService native access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.isNativeRuntime.mockReturnValue(true);
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
    legacyMocks.listParentTeamFeeRecipients.mockResolvedValue([]);
  });

  it('uses the authenticated server-authoritative callable with bounded native timeouts', async () => {
    httpMocks.post.mockResolvedValue({
      status: 200,
      data: {
        result: {
          items: [{
            id: 'recipient-1',
            teamId: 'team-1',
            batchId: 'batch-1',
            recipientId: 'recipient-1',
            playerKey: 'team-1::player-1',
            amountDueCents: 2500,
            paid: false
          }]
        }
      }
    });

    await expect(listParentTeamFeeRecipientsForApp('parent-1', childLinks)).resolves.toEqual([
      expect.objectContaining({
        id: 'recipient-1',
        playerKey: 'team-1::player-1',
        amountDueCents: 2500
      })
    ]);
    expect(legacyMocks.listParentTeamFeeRecipients).not.toHaveBeenCalled();
    expect(authMocks.getNativeAuthIdToken).toHaveBeenCalledWith(false);
    expect(httpMocks.post).toHaveBeenCalledWith({
      url: 'https://us-central1-demo-project.cloudfunctions.net/listParentTeamFeeRecipients',
      headers: expect.objectContaining({
        Authorization: 'Bearer native-id-token',
        'X-Firebase-AppCheck': 'debug-app-check'
      }),
      data: { data: {} },
      connectTimeout: 8000,
      readTimeout: 8000
    });
  });

  it('rejects invalid or failed callable responses instead of treating them as complete emptiness', async () => {
    httpMocks.post.mockResolvedValue({
      status: 503,
      data: { error: { message: 'Fee discovery unavailable.' } }
    });

    await expect(listParentTeamFeeRecipientsForApp('parent-1', childLinks))
      .rejects.toThrow('Fee discovery unavailable.');
  });

  it('refreshes once after an unauthenticated read response', async () => {
    authMocks.getNativeAuthIdToken
      .mockResolvedValueOnce('cached-token')
      .mockResolvedValueOnce('refreshed-token');
    httpMocks.post
      .mockResolvedValueOnce({ status: 401, data: { error: { message: 'Unauthenticated.' } } })
      .mockResolvedValueOnce({ status: 200, data: { result: { items: [] } } });

    await expect(listParentTeamFeeRecipientsForApp('parent-1', childLinks)).resolves.toEqual([]);

    expect(authMocks.getNativeAuthIdToken).toHaveBeenNthCalledWith(1, false);
    expect(authMocks.getNativeAuthIdToken).toHaveBeenNthCalledWith(2, true);
    expect(httpMocks.post).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permission-denied read response', async () => {
    httpMocks.post.mockResolvedValue({
      status: 403,
      data: { error: { message: 'Missing or insufficient permissions.' } }
    });

    await expect(listParentTeamFeeRecipientsForApp('parent-1', childLinks))
      .rejects.toThrow('Missing or insufficient permissions.');

    expect(authMocks.getNativeAuthIdToken).toHaveBeenCalledTimes(1);
    expect(authMocks.getNativeAuthIdToken).toHaveBeenCalledWith(false);
    expect(httpMocks.post).toHaveBeenCalledTimes(1);
  });

  it('recursively decodes callable Firestore timestamps for native fee history', async () => {
    httpMocks.post.mockResolvedValue({
      status: 200,
      data: {
        result: {
          items: [{
            id: 'recipient-1',
            dueAt: { seconds: 1_783_321_200, nanoseconds: 123_000_000 },
            paymentLedger: [{
              refundedAt: { _seconds: 1_783_407_600, _nanoseconds: 456_000_000 }
            }]
          }]
        }
      }
    });

    const [fee] = await listParentTeamFeeRecipientsForApp('parent-1', childLinks) as Array<Record<string, unknown>>;
    const paymentLedger = fee.paymentLedger as Array<Record<string, unknown>>;

    expect(fee.dueAt).toEqual(new Date(1_783_321_200_123));
    expect(paymentLedger[0].refundedAt).toEqual(new Date(1_783_407_600_456));
  });

  it('does not invoke the server when no user is signed in', async () => {
    await expect(listParentTeamFeeRecipientsForApp('', [])).resolves.toEqual([]);
    expect(httpMocks.post).not.toHaveBeenCalled();
    expect(authMocks.getNativeAuthIdToken).not.toHaveBeenCalled();
  });

  it('keeps the existing web loader outside native runtimes', async () => {
    runtimeMocks.isNativeRuntime.mockReturnValue(false);
    legacyMocks.listParentTeamFeeRecipients.mockResolvedValue([{ id: 'web-fee' }]);

    await expect(listParentTeamFeeRecipientsForApp('parent-1', childLinks))
      .resolves.toEqual([{ id: 'web-fee' }]);
    expect(legacyMocks.listParentTeamFeeRecipients).toHaveBeenCalledWith('parent-1', childLinks);
    expect(httpMocks.post).not.toHaveBeenCalled();
  });
});
