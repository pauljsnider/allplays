import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  httpPost: vi.fn(),
  httpsCallable: vi.fn(),
  isNativeRuntime: vi.fn(),
  getNativeAuthIdToken: vi.fn(),
  getPrimaryAppCheckHeaders: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { post: mocks.httpPost }
}));
vi.mock('./adapters/legacyOpportunityDb', () => ({
  functions: { kind: 'functions' },
  httpsCallable: mocks.httpsCallable
}));
vi.mock('./authService', () => ({
  firebaseAuth: { app: { options: { projectId: 'demo-allplays' } } },
  getNativeAuthIdToken: mocks.getNativeAuthIdToken
}));
vi.mock('./nativeRuntime', () => ({ isNativeRuntime: mocks.isNativeRuntime }));
vi.mock('./adapters/legacyFirebaseAppCheck', () => ({
  getPrimaryAppCheckHeaders: mocks.getPrimaryAppCheckHeaders
}));

import { getPublicOpportunity, listOpportunityInquiries, listPublicOpportunities } from './opportunityService';

describe('opportunity service native callables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativeRuntime.mockReturnValue(false);
    mocks.getNativeAuthIdToken.mockResolvedValue('native-token');
    mocks.getPrimaryAppCheckHeaders.mockImplementation(async (headers) => headers);
  });

  it('keeps web requests on the Firebase callable adapter', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { items: [], nextCursor: null } });
    mocks.httpsCallable.mockReturnValue(invoke);

    await expect(listOpportunityInquiries()).resolves.toEqual({ items: [], nextCursor: null });

    expect(mocks.httpsCallable).toHaveBeenCalledWith({ kind: 'functions' }, 'listOpportunityInquiries');
    expect(mocks.httpPost).not.toHaveBeenCalled();
  });

  it('uses the authenticated native HTTP bridge for inquiry discovery', async () => {
    mocks.isNativeRuntime.mockReturnValue(true);
    mocks.httpPost.mockResolvedValue({
      status: 200,
      data: { result: { items: [{ id: 'inquiry-1' }], nextCursor: null } },
      headers: {},
      url: ''
    });

    await expect(listOpportunityInquiries()).resolves.toEqual({
      items: [{ id: 'inquiry-1' }],
      nextCursor: null
    });

    expect(mocks.httpPost).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://us-central1-demo-allplays.cloudfunctions.net/listOpportunityInquiries',
      headers: expect.objectContaining({ Authorization: 'Bearer native-token' }),
      data: { data: {} }
    }));
    expect(mocks.httpsCallable).not.toHaveBeenCalled();
  });

  it.each([
    ['listPublicOpportunities', () => listPublicOpportunities()],
    ['getPublicOpportunity', () => getPublicOpportunity('listing-1')]
  ])('allows signed-out native callers to use public %s reads', async (callableName, invoke) => {
    mocks.isNativeRuntime.mockReturnValue(true);
    mocks.getNativeAuthIdToken.mockResolvedValue(null);
    mocks.httpPost.mockResolvedValue({
      status: 200,
      data: { result: callableName === 'getPublicOpportunity' ? { item: { id: 'listing-1' } } : { items: [], nextCursor: null } },
      headers: {},
      url: ''
    });

    await expect(invoke()).resolves.toBeTruthy();

    expect(mocks.httpPost).toHaveBeenCalledWith(expect.objectContaining({
      url: `https://us-central1-demo-allplays.cloudfunctions.net/${callableName}`,
      headers: expect.not.objectContaining({ Authorization: expect.anything() })
    }));
  });

  it('still requires native authentication for protected opportunity operations', async () => {
    mocks.isNativeRuntime.mockReturnValue(true);
    mocks.getNativeAuthIdToken.mockResolvedValue(null);

    await expect(createPublicOpportunity({} as any)).rejects.toThrow('Native opportunity access is unavailable.');
    expect(mocks.httpPost).not.toHaveBeenCalled();
  });

  it('surfaces native callable failures without inventing an empty inquiry list', async () => {
    mocks.isNativeRuntime.mockReturnValue(true);
    mocks.httpPost.mockResolvedValue({
      status: 403,
      data: { error: { message: 'Inquiry access denied.' } },
      headers: {},
      url: ''
    });

    await expect(listOpportunityInquiries()).rejects.toThrow('Inquiry access denied.');
  });

  it('allows signed-out native visitors to browse public opportunities without an Authorization header', async () => {
    mocks.isNativeRuntime.mockReturnValue(true);
    mocks.getNativeAuthIdToken.mockResolvedValue(null);
    mocks.httpPost
      .mockResolvedValueOnce({
        status: 200,
        data: { result: { items: [{ id: 'listing-1' }], nextCursor: null } },
        headers: {},
        url: ''
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { result: { item: { id: 'listing-1' } } },
        headers: {},
        url: ''
      });

    await expect(listPublicOpportunities()).resolves.toEqual({
      items: [{ id: 'listing-1' }],
      nextCursor: null
    });
    await expect(getPublicOpportunity('listing-1')).resolves.toEqual({ id: 'listing-1' });

    expect(mocks.httpPost).toHaveBeenCalledTimes(2);
    mocks.httpPost.mock.calls.forEach(([request]) => {
      expect(request.headers).toEqual({ 'Content-Type': 'application/json' });
    });
  });

  it('still requires native authentication for protected opportunity callables', async () => {
    mocks.isNativeRuntime.mockReturnValue(true);
    mocks.getNativeAuthIdToken.mockResolvedValue(null);

    await expect(listOpportunityInquiries()).rejects.toThrow('Native opportunity access is unavailable.');
    expect(mocks.httpPost).not.toHaveBeenCalled();
  });
});
