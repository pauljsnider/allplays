import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const call = vi.hoisted(() => vi.fn());
const native = vi.hoisted(() => vi.fn(() => false));
vi.mock('./adapters/resourcePacketsFirebase', () => ({ resourcePacketCall: call }));
vi.mock('./nativeRuntime', () => ({ isNativeRuntime: native }));
import {
  loadResourcePacketFamily,
  openResourcePacketLink,
  resourcePacketCommand,
  resourcePacketsAvailable,
  type PacketTask
} from './resourcePacketsService';
const task: PacketTask = {
  teamId: 'team',
  assignmentId: 'packet',
  version: 1,
  playerId: 'child',
  playerName: 'Synthetic child',
  title: 'Balance',
  notes: '',
  dueAt: null,
  timeZone: null,
  signals: {},
  items: [{ resourceId: 'resource', resourceVersion: 1, title: 'Footwork', teachingPoint: 'Balance', url: 'https://example.com/resource' }]
};
describe('web resource packet service', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_RESOURCE_PACKETS_ENABLED', 'true');
    call.mockReset();
    native.mockReturnValue(false);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it('fails closed for native and disabled rollouts', async () => {
    native.mockReturnValue(true);
    expect(resourcePacketsAvailable()).toBe(false);
    await expect(loadResourcePacketFamily('team', 'child')).rejects.toThrow('not enabled');
    expect(call).not.toHaveBeenCalled();
    native.mockReturnValue(false);
    vi.stubEnv('VITE_RESOURCE_PACKETS_ENABLED', 'false');
    expect(resourcePacketsAvailable()).toBe(false);
  });
  it('reads cannot record click telemetry', async () => {
    call.mockResolvedValue({ tasks: [task] });
    await loadResourcePacketFamily('team', 'child');
    expect(call).toHaveBeenCalledExactlyOnceWith('resourcePacketsQuery', { teamId: 'team', playerId: 'child', view: 'family' });
  });
  it('preserves request identity after uncertain network failure and separates actors', async () => {
    call.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue({ recorded: true });
    const data = { teamId: 'team', action: 'report', playerId: 'child', kind: 'practiced' };
    await expect(resourcePacketCommand('parent-a', data)).rejects.toThrow();
    await resourcePacketCommand('parent-a', data);
    expect(call.mock.calls[0][1].requestId).toBe(call.mock.calls[1][1].requestId);
    await resourcePacketCommand('parent-b', data);
    expect(call.mock.calls[2][1].requestId).not.toBe(call.mock.calls[1][1].requestId);
  });
  it('does not record a blocked popup and closes it on authorization failure', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await expect(openResourcePacketLink('parent', task, task.items[0])).rejects.toThrow('Allow');
    expect(call).not.toHaveBeenCalled();
    const close = vi.fn();
    const replace = vi.fn();
    open.mockReturnValue({ opener: {}, close, location: { replace } } as unknown as Window);
    call.mockRejectedValue(new Error('Access removed'));
    await expect(openResourcePacketLink('parent', task, task.items[0])).rejects.toThrow('Access removed');
    expect(close).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
  it('records only an authenticated deliberate open before navigating', async () => {
    const replace = vi.fn();
    const tab = { opener: {}, close: vi.fn(), location: { replace } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    call.mockResolvedValue({ url: task.items[0].url });
    await openResourcePacketLink('parent', task, task.items[0]);
    expect(tab.opener).toBeNull();
    expect(replace).toHaveBeenCalledWith(task.items[0].url);
    expect(call.mock.calls[0][1]).toMatchObject({ playerId: 'child', version: 1, kind: 'opened' });
    expect(call.mock.calls[0][1]).not.toHaveProperty('watched');
  });
});
