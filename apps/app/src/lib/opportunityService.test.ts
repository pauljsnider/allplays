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

import { listOpportunityInquiries } from './opportunityService';

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
});
