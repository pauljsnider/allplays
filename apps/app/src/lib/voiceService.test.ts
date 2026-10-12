import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoiceService, VoiceServiceError, type VoiceListenerHandle, type VoiceServiceSnapshot } from './voiceService';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
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
    expect(adapter.forceStop).toHaveBeenCalledOnce();
    expect(adapter.stop).not.toHaveBeenCalled();
  });

  it.each([
    ['recognition', { code: 'recognition', message: 'recognizer failed' }],
    ['network', { code: 'network', message: 'offline' }]
  ])('releases native capture exactly once on %s failure and emits no audio', async (_name, nativeError) => {
    const service = createVoiceService(adapter);
    const snapshots: VoiceServiceSnapshot[] = [];
    const errorListener = vi.fn();
    adapter.addErrorListener.mockImplementation(async (listener) => {
      errorListener.mockImplementation(listener);
      return listenerHandle();
    });
    service.subscribe((snapshot) => snapshots.push(snapshot));

    await service.start({});
    errorListener(nativeError);
    await vi.waitFor(() => expect(service.state).toBe('failure'));

    expect(adapter.forceStop).toHaveBeenCalledOnce();
    expect(adapter.stop).not.toHaveBeenCalled();
    expect(snapshots.every((snapshot) => !('audio' in snapshot) && !('rawAudio' in snapshot))).toBe(true);
  });

  it('releases native capture after transcription failure without emitting raw audio', async () => {
    const service = createVoiceService(adapter);
    const snapshots: VoiceServiceSnapshot[] = [];
    service.subscribe((snapshot) => snapshots.push(snapshot));
    adapter.getLastPartialResult.mockRejectedValueOnce(new Error('transcription unavailable'));

    await service.start({});
    const stop = service.stop();
    adapter.addListeningStateListener.mock.calls[0][0]({ state: 'stopped' });

    await expect(stop).resolves.toBeNull();
    expect(adapter.forceStop).toHaveBeenCalledOnce();
    expect(snapshots.every((snapshot) => !('audio' in snapshot) && !('rawAudio' in snapshot))).toBe(true);
  });

  it('maps denied permission and unavailable recognition to typed failures', async () => {
    const denied = createVoiceService(adapter);
    adapter.checkPermissions.mockResolvedValue({ speechRecognition: 'denied' });
    adapter.requestPermissions.mockResolvedValue({ speechRecognition: 'denied' });
    await expect(denied.start({})).rejects.toMatchObject({ code: 'permission_denied' } satisfies Partial<VoiceServiceError>);
    expect(denied.state).toBe('failure');
    expect(adapter.forceStop).toHaveBeenCalledOnce();

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
    const snapshots: Array<{ state: string; text?: string }> = [];
    adapter.addErrorListener.mockImplementation(async (listener) => {
      errorListener.mockImplementation(listener);
      return listenerHandle();
    });
    service.subscribe(({ state, result }) => snapshots.push({ state, text: result?.text }));
    await service.start({ language: 'es-MX' });
    adapter.addPartialResultsListener.mock.calls[0][0]({ accumulatedText: 'borrador' });
    errorListener({ code: 'network', message: 'offline', sessionId: 1 });
    await vi.waitFor(() => expect(service.state).toBe('failure'));
    await expect(service.stop()).resolves.toEqual({ text: 'borrador' });
    expect(snapshots).toContainEqual({ state: 'failure', text: 'borrador' });
    expect(service.state).toBe('failure');
    await expect(Promise.all([service.retry(), service.retry()])).resolves.toEqual([undefined, undefined]);
    expect(adapter.start).toHaveBeenLastCalledWith({ language: 'es-MX', partialResults: true });
    expect(adapter.start).toHaveBeenCalledTimes(2);
  });

  it('classifies transcription retrieval failures separately and preserves the draft', async () => {
    const service = createVoiceService(adapter);
    const failures: VoiceServiceError[] = [];
    service.subscribe(({ error }) => {
      if (error) failures.push(error);
    });
    adapter.getLastPartialResult.mockRejectedValueOnce(new Error('malformed transcription response'));

    await service.start({});
    adapter.addPartialResultsListener.mock.calls[0][0]({ accumulatedText: 'keep this draft' });
    const stop = service.stop();
    adapter.addListeningStateListener.mock.calls[0][0]({ state: 'stopped' });

    await expect(stop).resolves.toEqual({ text: 'keep this draft' });
    expect(service.state).toBe('failure');
    expect(failures[failures.length - 1]).toMatchObject({ code: 'transcription_failed' });
  });

  it('cancels a start while permission acquisition is pending', async () => {
    const permission = deferred<{ speechRecognition: 'granted' }>();
    adapter.checkPermissions.mockReturnValueOnce(permission.promise);
    const service = createVoiceService(adapter);

    const start = service.start({ language: 'en-US' });
    await vi.waitFor(() => expect(adapter.checkPermissions).toHaveBeenCalled());
    const stop = service.stop();
    permission.resolve({ speechRecognition: 'granted' });

    await expect(stop).resolves.toBeNull();
    await expect(start).resolves.toBeUndefined();
    expect(adapter.start).not.toHaveBeenCalled();
    expect(service.state).toBe('idle');
  });

  it('cancels a start while listener registration is pending', async () => {
    const partialHandle = deferred<VoiceListenerHandle>();
    adapter.addPartialResultsListener.mockReturnValueOnce(partialHandle.promise);
    const service = createVoiceService(adapter);

    const start = service.start({ language: 'en-US' });
    await vi.waitFor(() => expect(adapter.addPartialResultsListener).toHaveBeenCalled());
    expect(service.state).toBe('idle');
    const stop = service.stop();
    partialHandle.resolve(listenerHandle());

    await expect(stop).resolves.toBeNull();
    await expect(start).resolves.toBeUndefined();
    expect(adapter.addListeningStateListener).not.toHaveBeenCalled();
    expect(adapter.start).not.toHaveBeenCalled();
    expect(service.state).toBe('idle');
  });

  it('reuses a pending start while listener registration is pending', async () => {
    const partialHandle = deferred<VoiceListenerHandle>();
    adapter.addPartialResultsListener.mockReturnValueOnce(partialHandle.promise);
    const service = createVoiceService(adapter);

    const firstStart = service.start({ language: 'en-US' });
    await vi.waitFor(() => expect(adapter.addPartialResultsListener).toHaveBeenCalled());
    expect(service.state).toBe('idle');
    const secondStart = service.start({ language: 'en-US' });
    partialHandle.resolve(listenerHandle());

    await expect(Promise.all([firstStart, secondStart])).resolves.toEqual([undefined, undefined]);
    expect(adapter.addPartialResultsListener).toHaveBeenCalledOnce();
    expect(adapter.addListeningStateListener).toHaveBeenCalledOnce();
    expect(adapter.addErrorListener).toHaveBeenCalledOnce();
    expect(adapter.start).toHaveBeenCalledOnce();
  });

  it('waits for a pending native start before force-stopping capture', async () => {
    const nativeStart = deferred<{ matches: string[] }>();
    adapter.start.mockReturnValueOnce(nativeStart.promise);
    const service = createVoiceService(adapter);

    const start = service.start({ language: 'en-US' });
    await vi.waitFor(() => expect(adapter.start).toHaveBeenCalled());
    const stop = service.stop();
    expect(adapter.forceStop).not.toHaveBeenCalled();

    nativeStart.resolve({ matches: [] });
    await expect(start).resolves.toBeUndefined();
    await vi.waitFor(() => expect(adapter.forceStop).toHaveBeenCalledOnce());
    adapter.addListeningStateListener.mock.calls[0][0]({ state: 'stopped' });

    await expect(stop).resolves.toEqual({ text: 'hello draft' });
  });

  it('converts force-stop and fallback-stop failures to a cleaned-up typed failure', async () => {
    const partialHandle = listenerHandle();
    const stateHandle = listenerHandle();
    const errorHandle = listenerHandle();
    adapter.addPartialResultsListener.mockResolvedValueOnce(partialHandle);
    adapter.addListeningStateListener.mockResolvedValueOnce(stateHandle);
    adapter.addErrorListener.mockResolvedValueOnce(errorHandle);
    adapter.forceStop.mockRejectedValueOnce(new Error('force stop failed'));
    adapter.stop.mockRejectedValueOnce(new Error('stop failed'));
    const service = createVoiceService(adapter);

    await service.start({});
    await expect(service.stop()).rejects.toMatchObject({ code: 'recognition_failed' } satisfies Partial<VoiceServiceError>);

    expect(service.state).toBe('failure');
    expect(partialHandle.remove).toHaveBeenCalledOnce();
    expect(stateHandle.remove).toHaveBeenCalledOnce();
    expect(errorHandle.remove).toHaveBeenCalledOnce();
  });

  it.each([
    ['listening-state', 'addListeningStateListener', 1],
    ['error', 'addErrorListener', 2]
  ] as const)('rolls back registered listeners when %s listener registration fails', async (_name, method, removedCount) => {
    const partialHandle = listenerHandle();
    const stateHandle = listenerHandle();
    adapter.addPartialResultsListener.mockResolvedValueOnce(partialHandle);
    if (method === 'addListeningStateListener') {
      adapter.addListeningStateListener.mockRejectedValueOnce(new Error('registration failed'));
    } else {
      adapter.addListeningStateListener.mockResolvedValueOnce(stateHandle);
      adapter.addErrorListener.mockRejectedValueOnce(new Error('registration failed'));
    }
    const service = createVoiceService(adapter);

    await expect(service.start({})).rejects.toMatchObject({ code: 'recognition_failed' } satisfies Partial<VoiceServiceError>);

    expect(partialHandle.remove).toHaveBeenCalledOnce();
    expect(stateHandle.remove).toHaveBeenCalledTimes(removedCount === 2 ? 1 : 0);
  });
});
