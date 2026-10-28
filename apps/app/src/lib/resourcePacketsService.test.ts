import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const call = vi.hoisted(() => vi.fn());
const browser = vi.hoisted(() => ({ open: vi.fn(), available: vi.fn(() => true) }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: browser.open } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isPluginAvailable: browser.available } }));
const principal = vi.hoisted(() => vi.fn(() => 'native-parent'));
vi.mock('./authService', () => ({ getNativeAuthUserId: principal }));
const native = vi.hoisted(() => vi.fn(() => false));
vi.mock('./adapters/resourcePacketsFirebase', () => ({ resourcePacketCall: call }));
vi.mock('./nativeRuntime', () => ({ isNativeRuntime: native }));
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
describe('resource packet service', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_RESOURCE_PACKETS_ENABLED', 'true');
    call.mockReset();
    browser.open.mockReset().mockResolvedValue(undefined);
    browser.available.mockReturnValue(true);
    native.mockReturnValue(false);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it('fails closed for disabled rollouts on web and native', async () => {
    vi.stubEnv('VITE_RESOURCE_PACKETS_ENABLED', 'false');
    native.mockReturnValue(true);
    expect(resourcePacketsAvailable()).toBe(false);
    await expect(loadResourcePacketFamily('team', 'child')).rejects.toThrow('not enabled');
    expect(call).not.toHaveBeenCalled();
    native.mockReturnValue(false);
    vi.stubEnv('VITE_RESOURCE_PACKETS_ENABLED', 'true');
    expect(resourcePacketsAvailable()).toBe(true);
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

describe('native assignment opening', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_RESOURCE_PACKETS_ENABLED', 'true');
    native.mockReturnValue(true);
    principal.mockReturnValue('native-parent');
    browser.available.mockReturnValue(true);
    browser.open.mockReset().mockResolvedValue(undefined);
    call.mockReset().mockImplementation(async (name) => name === 'resourcePacketsQuery' ? { url: task.items[0].url } : { recorded: true });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it('reauthorizes, opens the native browser, then records only opened; no popup', async () => {
    const popup = vi.spyOn(window, 'open');
    await openResourcePacketLink('native-parent', task, task.items[0]);
    expect(resourcePacketsAvailable()).toBe(true);
    expect(popup).not.toHaveBeenCalled();
    expect(call.mock.calls[0]).toEqual(['resourcePacketsQuery', {
      teamId: 'team',
      view: 'openLink',
      assignmentId: 'packet',
      version: 1,
      playerId: 'child',
      resourceId: 'resource'
    }, 'native-parent']);
    expect(browser.open).toHaveBeenCalledWith({ url: task.items[0].url });
    expect(call.mock.invocationCallOrder[0]).toBeLessThan(browser.open.mock.invocationCallOrder[0]);
    expect(browser.open.mock.invocationCallOrder[0]).toBeLessThan(call.mock.invocationCallOrder[1]);
    expect(call.mock.calls[1][1]).toMatchObject({ action: 'report', kind: 'opened', playerId: 'child', version: 1 });
  });
  it.each([null, 'another-parent'])('does not launch after the initiating account changes during the query (%s)', async (uid) => {
    let resolveQuery!: (page: { url: string }) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { resolveQuery = resolve; }));
    const result = openResourcePacketLink('native-parent', task, task.items[0]);
    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
    principal.mockReturnValue(uid as string);
    resolveQuery({ url: task.items[0].url });
    await expect(result).rejects.toThrow('Account changed');
    expect(browser.open).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledOnce();
  });
  it('does not record a failed native launch', async () => {
    browser.open.mockRejectedValue(new Error('Native launch cancelled'));
    await expect(openResourcePacketLink('native-parent', task, task.items[0])).rejects.toThrow('cancelled');
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('does not launch or record without the plugin', async () => {
    browser.available.mockReturnValue(false);
    await expect(openResourcePacketLink('native-parent', task, task.items[0])).rejects.toThrow('unavailable');
    expect(call).not.toHaveBeenCalled(); expect(browser.open).not.toHaveBeenCalled();
  });
  it.each(['offline', 'permission-denied'])('does not launch on %s reauthorization', async (reason) => {
    call.mockRejectedValue(new Error(reason));
    await expect(openResourcePacketLink('native-parent', task, task.items[0])).rejects.toThrow();
    expect(browser.open).not.toHaveBeenCalled();
  });
  it.each(['https://example.com/replaced', 'https://example.com/resource?version=2'])('rejects a replaced assignment URL: %s', async (url) => {
    call.mockResolvedValue({ url });
    await expect(openResourcePacketLink('native-parent', task, task.items[0])).rejects.toThrow('changed');
    expect(browser.open).not.toHaveBeenCalled(); expect(call).toHaveBeenCalledTimes(1);
  });
  it.each(['javascript:alert(1)', 'https://user:secret@example.com/'])('rejects unsafe destinations before launch: %s', async (url) => {
    const unsafe = {...task, items: [{...task.items[0], url}]};
    call.mockResolvedValue({ url });
    await expect(openResourcePacketLink('native-parent', unsafe, unsafe.items[0])).rejects.toThrow('unavailable');
    expect(browser.open).not.toHaveBeenCalled();
  });
  it('keeps uncertain progress identity and reports launch truthfully on explicit retry', async () => {
    principal.mockReturnValue('native-retry');
    call.mockResolvedValueOnce({ url: task.items[0].url }).mockRejectedValueOnce(new Error('offline'));
    await expect(openResourcePacketLink('native-retry', task, task.items[0])).rejects.toThrow('link opened, but progress could not be confirmed');
    const requestId = call.mock.calls[1][1].requestId;
    await openResourcePacketLink('native-retry', task, task.items[0]);
    expect(call.mock.calls[3][1].requestId).toBe(requestId);
    expect(browser.open).toHaveBeenCalledTimes(2);
  });
});
