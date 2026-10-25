import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ native: vi.fn(), call: vi.fn(), web: vi.fn(), invoke: vi.fn() }));
vi.mock('../nativeRuntime', () => ({ isNativeRuntime: mocks.native }));
vi.mock('../nativeCallable', () => ({ callNativeFirebaseFunction: mocks.call }));
vi.mock('@legacy/firebase.js', () => ({ functions: 'web-functions', httpsCallable: mocks.web }));
import { resourcePacketCall } from './resourcePacketsFirebase';
describe('assignment transport', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.web.mockReturnValue(mocks.invoke);
  });
  it('uses current authenticated native transport, never legacy web auth', async () => {
    mocks.native.mockReturnValue(true);
    mocks.call.mockResolvedValue({ tasks: [] });
    expect(await resourcePacketCall('resourcePacketsQuery', { view: 'family' })).toEqual({ tasks: [] });
    expect(mocks.call).toHaveBeenCalledWith('resourcePacketsQuery', { view: 'family' }, { errorLabel: 'Video assignment request' });
    expect(mocks.web).not.toHaveBeenCalled();
  });
  it('pins native commands to the initiating account', async () => {
    mocks.native.mockReturnValue(true);
    await resourcePacketCall('resourcePacketsCommand', { action: 'report' }, 'parent-1');
    expect(mocks.call).toHaveBeenCalledWith(
      'resourcePacketsCommand',
      { action: 'report' },
      { errorLabel: 'Video assignment request', expectedUid: 'parent-1' }
    );
  });
  it('preserves web callable behavior', async () => {
    mocks.native.mockReturnValue(false);
    mocks.invoke.mockResolvedValue({ data: { tasks: [] } });
    expect(await resourcePacketCall('resourcePacketsQuery', {})).toEqual({ tasks: [] });
    expect(mocks.call).not.toHaveBeenCalled();
  });
});
