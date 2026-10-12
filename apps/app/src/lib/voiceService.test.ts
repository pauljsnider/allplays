import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoiceService, VoiceServiceError, type VoiceListenerHandle } from './voiceService';

const adapter = {
  available: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  forceStop: vi.fn(),
  getLastPartialResult: vi.fn(),
  addPartialResultsListener: vi.fn(),
  addListeningStateListener: vi.fn(),
  addErrorListener: vi.fn()
};

function listenerHandle(): VoiceListenerHandle {
  return { remove: vi.fn().mockResolvedValue(undefined) } as VoiceListenerHandle;
}

describe('voice service lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapter.available.mockResolvedValue({ available: true });
    adapter.checkPermissions.mockResolvedValue({ speechRecognition: 'granted' });
    adapter.requestPermissions.mockResolvedValue({ speechRecognition: 'granted' });
    adapter.start.mockResolvedValue({ matches: [] });
    adapter.stop.mockResolvedValue(undefined);
    adapter.forceStop.mockResolvedValue(undefined);
    adapter.getLastPartialResult.mockResolvedValue({ available: true, text: 'hello draft' });
    adapter.addPartialResultsListener.mockResolvedValue(listenerHandle());
    adapter.addListeningStateListener.mockResolvedValue(listenerHandle());
    adapter.addErrorListener.mockResolvedValue(listenerHandle());
  });

  it('exposes permission, recording, transcribing, and success states', async () => {
    const service = createVoiceService(adapter);
    const states: string[] = [];
    service.subscribe(({ state }) => states.push(state));

    await service.start({ language: 'en-US' });
    expect(service.state).toBe('recording');

    const stop = service.stop();
    const listeningListener = adapter.addListeningStateListener.mock.calls[0][0];
    listeningListener({ state: 'stopped', status: 'stopped' });
    await expect(stop).resolves.toEqual({ text: 'hello draft' });
    expect(states).toEqual(['idle', 'permission', 'idle', 'recording', 'transcribing', 'success']);
  });

  it('maps denied permission and unavailable recognition to typed failures', async () => {
    const denied = createVoiceService(adapter);
    adapter.checkPermissions.mockResolvedValue({ speechRecognition: 'denied' });
    adapter.requestPermissions.mockResolvedValue({ speechRecognition: 'denied' });
    await expect(denied.start({})).rejects.toMatchObject({ code: 'permission_denied' } satisfies Partial<VoiceServiceError>);
    expect(denied.state).toBe('failure');

    adapter.available.mockResolvedValue({ available: false });
    const unavailable = createVoiceService(adapter);
    await expect(unavailable.start({})).rejects.toMatchObject({ code: 'unavailable' } satisfies Partial<VoiceServiceError>);
  });

  it('makes repeated starts and stops idempotent and emits one completion', async () => {
    const service = createVoiceService(adapter);
    const snapshots: string[] = [];
    service.subscribe(({ state }) => snapshots.push(state));
    const firstStart = service.start({});
    const secondStart = service.start({});
    await Promise.all([firstStart, secondStart]);
    expect(adapter.start).toHaveBeenCalledTimes(1);

    const firstStop = service.stop();
    const secondStop = service.stop();
    adapter.addListeningStateListener.mock.calls[0][0]({ state: 'stopped' });
    await expect(Promise.all([firstStop, secondStop])).resolves.toEqual([{ text: 'hello draft' }, { text: 'hello draft' }]);
    expect(snapshots.filter((state) => state === 'success')).toHaveLength(1);
  });

  it('preserves a retryable failure and classifies network errors', async () => {
    const service = createVoiceService(adapter);
    const errorListener = vi.fn();
    adapter.addErrorListener.mockImplementation(async (listener) => {
      errorListener.mockImplementation(listener);
      return listenerHandle();
    });
    await service.start({});
    const stop = service.stop();
    errorListener({ code: 'network', message: 'offline', sessionId: 1 });
    await expect(stop).rejects.toMatchObject({ code: 'network_failed' } satisfies Partial<VoiceServiceError>);
    expect(service.state).toBe('failure');
    await expect(service.retry()).resolves.toBeUndefined();
    expect(adapter.start).toHaveBeenCalledTimes(2);
  });
});
