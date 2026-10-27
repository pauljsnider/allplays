import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const call = vi.hoisted(() => vi.fn());
const native = vi.hoisted(() => vi.fn(() => false));
const publicOpen = vi.hoisted(() => vi.fn());
vi.mock('./adapters/resourcePacketsFirebase', () => ({ resourcePacketCall: call }));
vi.mock('./nativeRuntime', () => ({ isNativeRuntime: native }));
vi.mock('./publicActions', () => ({ openPublicUrl: publicOpen }));
import {
  loadResourcePacketFamily,
  loadResourcePacketYouTubeMetadata,
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
    publicOpen.mockReset();
    native.mockReturnValue(false);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it('uses the same feature flag on native and web', async () => {
    native.mockReturnValue(true);
    expect(resourcePacketsAvailable()).toBe(true);
    vi.stubEnv('VITE_RESOURCE_PACKETS_ENABLED', 'false');
    expect(resourcePacketsAvailable()).toBe(false);
  });
  it('reads cannot record click telemetry', async () => {
    call.mockResolvedValue({ tasks: [task] });
    await loadResourcePacketFamily('team', 'child');
    expect(call).toHaveBeenCalledExactlyOnceWith('resourcePacketsQuery', { teamId: 'team', playerId: 'child', view: 'family' });
  });
  it('loads YouTube metadata through the authenticated team query', async () => {
    call.mockResolvedValue({ videoId: 'abcdefghijk', source: 'youtube_oembed' });
    await loadResourcePacketYouTubeMetadata('team', 'https://youtu.be/abcdefghijk');
    expect(call).toHaveBeenCalledExactlyOnceWith('resourcePacketsQuery', {
      teamId: 'team',
      view: 'youtubeMetadata',
      url: 'https://youtu.be/abcdefghijk'
    });
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
    expect(call).toHaveBeenCalledExactlyOnceWith('resourcePacketsQuery', expect.objectContaining({ view: 'openLink' }));
    expect(close).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
  it('authorizes, navigates, then records a deliberate web open', async () => {
    const events: string[] = [];
    const replace = vi.fn(() => events.push('navigate'));
    const tab = { opener: {}, close: vi.fn(), location: { replace } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    call.mockImplementation(async (name, data) => {
      if (name === 'resourcePacketsQuery') {
        events.push('authorize');
        return { url: task.items[0].url };
      }
      events.push('report');
      expect(data).toMatchObject({ playerId: 'child', version: 1, kind: 'opened' });
      return { recorded: true };
    });
    await openResourcePacketLink('parent', task, task.items[0]);
    expect(tab.opener).toBeNull();
    expect(replace).toHaveBeenCalledWith(task.items[0].url);
    expect(events).toEqual(['authorize', 'navigate', 'report']);
    expect(call.mock.calls[1][1]).not.toHaveProperty('watched');
  });
  it('uses the system browser before recording a deliberate native open', async () => {
    const events: string[] = [];
    native.mockReturnValue(true);
    call.mockImplementation(async (name) => {
      events.push(name === 'resourcePacketsQuery' ? 'authorize' : 'report');
      return name === 'resourcePacketsQuery' ? { url: task.items[0].url } : { recorded: true };
    });
    publicOpen.mockImplementation(async () => events.push('open'));
    await openResourcePacketLink('parent', task, task.items[0]);
    expect(publicOpen).toHaveBeenCalledWith(task.items[0].url);
    expect(events).toEqual(['authorize', 'open', 'report']);
    expect(call.mock.calls[1][1]).toMatchObject({ playerId: 'child', kind: 'opened' });
  });
  it('does not record an open when the native browser launch fails', async () => {
    native.mockReturnValue(true);
    call.mockResolvedValue({ url: task.items[0].url });
    publicOpen.mockRejectedValue(new Error('Browser unavailable'));
    await expect(openResourcePacketLink('parent', task, task.items[0])).rejects.toThrow('Browser unavailable');
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('resourcePacketsQuery', expect.objectContaining({ view: 'openLink' }));
  });
  it('keeps the navigated tab open when recording fails afterward', async () => {
    const close = vi.fn();
    const replace = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({ opener: {}, close, location: { replace } } as unknown as Window);
    call.mockResolvedValueOnce({ url: task.items[0].url }).mockRejectedValueOnce(new Error('Save unavailable'));
    await expect(openResourcePacketLink('parent', task, task.items[0])).rejects.toThrow('Save unavailable');
    expect(replace).toHaveBeenCalledWith(task.items[0].url);
    expect(close).not.toHaveBeenCalled();
  });
});
