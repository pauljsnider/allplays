import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('./adapters/legacyHomeFees', () => legacyMocks);
vi.mock('./adapters/legacyFirebaseAppCheck', () => appCheckMocks);
vi.mock('./authService', () => authMocks);
vi.mock('./nativeRuntime', () => runtimeMocks);

import { listParentTeamFeeRecipientsForApp } from './parentFeeRecipientsService';

const childLinks = [{ teamId: 'team-1', playerId: 'player-1' }];

function firestoreDocument() {
  return {
    name: 'projects/demo-project/databases/(default)/documents/teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1',
    fields: {
      teamId: { stringValue: 'team-1' },
      batchId: { stringValue: 'batch-1' },
      recipientId: { stringValue: 'recipient-1' },
      playerId: { stringValue: 'player-1' },
      parentUserId: { stringValue: 'parent-1' },
      amountDueCents: { integerValue: '2500' },
      paid: { booleanValue: false }
    }
  };
}

describe('parentFeeRecipientsService native access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.isNativeRuntime.mockReturnValue(true);
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
    legacyMocks.listParentTeamFeeRecipients.mockResolvedValue([]);
  });

  it('uses authenticated collection-group REST queries in native builds', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const query = JSON.parse(String(init?.body || '{}'));
      const fieldPath = query.structuredQuery.where.compositeFilter.filters[1].fieldFilter.field.fieldPath;
      return {
        ok: true,
        status: 200,
        json: async () => fieldPath === 'parentUserId' ? [{ document: firestoreDocument() }] : []
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listParentTeamFeeRecipientsForApp('parent-1', childLinks)).resolves.toEqual([
      expect.objectContaining({
        id: 'recipient-1',
        teamId: 'team-1',
        batchId: 'batch-1',
        recipientId: 'recipient-1',
        playerKey: 'team-1::player-1',
        amountDueCents: 2500,
        paid: false
      })
    ]);

    expect(legacyMocks.listParentTeamFeeRecipients).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://firestore.googleapis.com/v1/projects/demo-project/databases/(default)/documents:runQuery',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer native-id-token',
          'X-Firebase-AppCheck': 'debug-app-check'
        })
      })
    );
    for (const [, init] of fetchMock.mock.calls) {
      const query = JSON.parse(String(init?.body || '{}'));
      expect(query.structuredQuery.from).toEqual([{ collectionId: 'feeRecipients', allDescendants: true }]);
      expect(query.structuredQuery.where.compositeFilter.filters[0].fieldFilter).toEqual(expect.objectContaining({
        field: { fieldPath: 'teamId' },
        op: 'EQUAL',
        value: { stringValue: 'team-1' }
      }));
    }
    const recipientFilters = fetchMock.mock.calls.map(([, init]) => {
      const query = JSON.parse(String(init?.body || '{}'));
      return query.structuredQuery.where.compositeFilter.filters[1].fieldFilter;
    });
    expect(recipientFilters).toContainEqual({
      field: { fieldPath: 'playerKey' },
      op: 'EQUAL',
      value: { stringValue: 'team-1::player-1' }
    });
    expect(recipientFilters).not.toContainEqual(expect.objectContaining({
      field: { fieldPath: 'playerId' }
    }));
  });

  it('rejects the complete load when any bounded native query is denied', async () => {
    let requestNumber = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      requestNumber += 1;
      if (requestNumber === 2) {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: { message: 'Missing or insufficient permissions.' } })
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    }));

    await expect(listParentTeamFeeRecipientsForApp('parent-1', childLinks))
      .rejects.toMatchObject({ message: 'Missing or insufficient permissions.', code: 'permission-denied' });
  });

  it('returns a complete empty result without querying when no player links exist', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(listParentTeamFeeRecipientsForApp('parent-1', [])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(authMocks.getNativeAuthIdToken).not.toHaveBeenCalled();
  });

  it('keeps the existing web loader outside native runtimes', async () => {
    runtimeMocks.isNativeRuntime.mockReturnValue(false);
    legacyMocks.listParentTeamFeeRecipients.mockResolvedValue([{ id: 'web-fee' }]);

    await expect(listParentTeamFeeRecipientsForApp('parent-1', childLinks))
      .resolves.toEqual([{ id: 'web-fee' }]);
    expect(legacyMocks.listParentTeamFeeRecipients).toHaveBeenCalledWith('parent-1', childLinks);
  });
});
