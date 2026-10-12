import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import type {
  LastPartialResult,
  SpeechRecognitionAvailability,
  SpeechRecognitionListeningEvent,
  SpeechRecognitionPartialResultEvent,
  SpeechRecognitionPermissionStatus,
  SpeechRecognitionStartOptions,
  SpeechRecognitionErrorEvent
} from '@capgo/capacitor-speech-recognition';

export type VoiceListenerHandle = PluginListenerHandle;

export type VoiceServiceState = 'permission' | 'idle' | 'recording' | 'transcribing' | 'success' | 'failure';

export type VoiceServiceErrorCode = 'permission_denied' | 'unavailable' | 'recognition_failed' | 'network_failed' | 'transcription_failed';

export class VoiceServiceError extends Error {
  readonly code: VoiceServiceErrorCode;
  readonly cause?: unknown;

  constructor(code: VoiceServiceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'VoiceServiceError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export interface VoiceTranscriptResult {
  text: string;
}

export interface VoiceServiceSnapshot {
  state: VoiceServiceState;
  result?: VoiceTranscriptResult;
  error?: VoiceServiceError;
}

export interface VoiceService {
  readonly state: VoiceServiceState;
  start(options: SpeechRecognitionStartOptions): Promise<void>;
  stop(): Promise<VoiceTranscriptResult | null>;
  retry(): Promise<void>;
  subscribe(listener: (snapshot: VoiceServiceSnapshot) => void): () => void;
}

type NativeSpeechRecognitionPlugin = (typeof import('@capgo/capacitor-speech-recognition'))['SpeechRecognition'];

let nativeSpeechRecognitionPromise: Promise<NativeSpeechRecognitionPlugin> | null = null;

function loadNativeSpeechRecognition(): Promise<NativeSpeechRecognitionPlugin> {
  if (!nativeSpeechRecognitionPromise) {
    nativeSpeechRecognitionPromise = import('@capgo/capacitor-speech-recognition').then((module) => module.SpeechRecognition);
  }
  return nativeSpeechRecognitionPromise;
}

export const voiceRecognition = {
  isNativeRuntime() {
    return Capacitor.isNativePlatform();
  },

  hasBrowserSupport() {
    return typeof window !== 'undefined' && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  },

  async available(): Promise<SpeechRecognitionAvailability> {
    return (await loadNativeSpeechRecognition()).available();
  },

  async checkPermissions(): Promise<SpeechRecognitionPermissionStatus> {
    return (await loadNativeSpeechRecognition()).checkPermissions();
  },

  async requestPermissions(): Promise<SpeechRecognitionPermissionStatus> {
    return (await loadNativeSpeechRecognition()).requestPermissions();
  },

  async start(options: SpeechRecognitionStartOptions) {
    return (await loadNativeSpeechRecognition()).start(options);
  },

  async stop() {
    return (await loadNativeSpeechRecognition()).stop();
  },

  async forceStop(options: { timeout: number }) {
    return (await loadNativeSpeechRecognition()).forceStop(options);
  },

  async getLastPartialResult(): Promise<LastPartialResult> {
    return (await loadNativeSpeechRecognition()).getLastPartialResult();
  },

  async addPartialResultsListener(listener: (event: SpeechRecognitionPartialResultEvent) => void): Promise<VoiceListenerHandle> {
    return (await loadNativeSpeechRecognition()).addListener('partialResults', listener);
  },

  async addListeningStateListener(listener: (event: SpeechRecognitionListeningEvent) => void): Promise<VoiceListenerHandle> {
    return (await loadNativeSpeechRecognition()).addListener('listeningState', listener);
  },

  async addErrorListener(listener: (event: SpeechRecognitionErrorEvent) => void): Promise<VoiceListenerHandle> {
    return (await loadNativeSpeechRecognition()).addListener('error', listener);
  }
};

type VoiceRecognitionAdapter = Pick<
  typeof voiceRecognition,
  | 'available'
  | 'checkPermissions'
  | 'requestPermissions'
  | 'start'
  | 'stop'
  | 'forceStop'
  | 'getLastPartialResult'
  | 'addPartialResultsListener'
  | 'addListeningStateListener'
  | 'addErrorListener'
>;

function voiceErrorFromNative(error: unknown): VoiceServiceError {
  const nativeError = error as (Partial<SpeechRecognitionErrorEvent> & { code?: string; error?: string }) | null;
  const code = String(nativeError?.code || nativeError?.error || '').toLowerCase();
  const errorCode: VoiceServiceErrorCode = code === 'network' ? 'network_failed' : 'recognition_failed';
  return new VoiceServiceError(
    errorCode,
    nativeError?.message || (error instanceof Error ? error.message : 'Voice recognition failed. Try again.'),
    { cause: error }
  );
}

function transcriptionErrorFromNative(error: unknown): VoiceServiceError {
  const nativeError = error as (Partial<SpeechRecognitionErrorEvent> & { code?: string; error?: string }) | null;
  const code = String(nativeError?.code || nativeError?.error || '').toLowerCase();
  if (code === 'network') return voiceErrorFromNative(error);
  return new VoiceServiceError(
    'transcription_failed',
    nativeError?.message || (error instanceof Error ? error.message : 'Voice transcription failed. Try again.'),
    { cause: error }
  );
}

/**
 * Bounded speech-capture lifecycle. The service exposes transcripts only; the
 * native plugin owns microphone buffers and they are never retained or emitted.
 */
export function createVoiceService(adapter: VoiceRecognitionAdapter = voiceRecognition): VoiceService {
  let currentState: VoiceServiceState = 'idle';
  let currentError: VoiceServiceError | undefined;
  let currentResult: VoiceTranscriptResult | undefined;
  let startPromise: Promise<void> | null = null;
  let startPending = false;
  let stopPromise: Promise<VoiceTranscriptResult | null> | null = null;
  let retryPromise: Promise<void> | null = null;
  let completionSettled = false;
  let completionResolve: ((result: VoiceTranscriptResult | null) => void) | null = null;
  let completionReject: ((error: VoiceServiceError) => void) | null = null;
  let completionPromise: Promise<VoiceTranscriptResult | null> | null = null;
  let transcript = '';
  let handles: VoiceListenerHandle[] = [];
  let captureReleased = false;
  let stopRequested = false;
  let lastStartOptions: SpeechRecognitionStartOptions | null = null;
  const subscribers = new Set<(snapshot: VoiceServiceSnapshot) => void>();

  const draftResult = (): VoiceTranscriptResult | undefined => {
    const text = transcript.trim();
    return text ? { text } : undefined;
  };

  const snapshot = (): VoiceServiceSnapshot => ({
    state: currentState,
    ...(currentResult ? { result: currentResult } : {}),
    ...(currentError ? { error: currentError } : {})
  });

  const emit = (state: VoiceServiceState, result?: VoiceTranscriptResult, error?: VoiceServiceError) => {
    currentState = state;
    currentResult = result;
    currentError = error;
    const next = snapshot();
    subscribers.forEach((listener) => listener(next));
  };

  const removeListeners = async () => {
    const activeHandles = handles;
    handles = [];
    await Promise.all(activeHandles.map((handle) => handle.remove().catch(() => undefined)));
  };

  const isCaptureActive = () => currentState === 'recording' || currentState === 'transcribing';

  const releaseCapture = async () => {
    if (captureReleased) return;
    captureReleased = true;
    try {
      await adapter.forceStop({ timeout: 1200 });
    } catch {
      await adapter.stop();
    }
  };

  const settle = async (result: VoiceTranscriptResult | null, error?: VoiceServiceError) => {
    if (completionSettled) return;
    completionSettled = true;
    await removeListeners();
    try {
      await releaseCapture();
    } catch (releaseError) {
      if (!error) error = voiceErrorFromNative(releaseError);
    }
    if (error) {
      const preservedDraft = draftResult();
      emit('failure', preservedDraft, error);
      completionResolve?.(preservedDraft || null);
    } else if (result) {
      emit('success', result);
      completionResolve?.(result);
    } else {
      emit('idle');
      completionResolve?.(null);
    }
    completionResolve = null;
    completionReject = null;
  };

  const finishFromPlugin = async () => {
    if (completionSettled) return;
    emit('transcribing');
    try {
      const partial = await adapter.getLastPartialResult();
      const text = (partial.text || partial.matches?.[0] || transcript).trim();
      if (!text) {
        await settle(null, new VoiceServiceError('transcription_failed', 'No transcription was returned.'));
        return;
      }
      await settle({ text });
    } catch (error) {
      await settle(null, transcriptionErrorFromNative(error));
    }
  };

  const begin = async (options: SpeechRecognitionStartOptions, preserveTranscript = false) => {
    if (!preserveTranscript) transcript = '';
    completionSettled = false;
    captureReleased = false;
    completionPromise = null;
    completionResolve = null;
    completionReject = null;
    const preservedDraft = draftResult();
    emit('permission', preservedDraft);
    try {
      const available = await adapter.available();
      if (stopRequested) {
        emit('idle', preservedDraft);
        return;
      }
      if (!available.available) {
        throw new VoiceServiceError('unavailable', 'Voice recognition is not available on this device.');
      }
      let permissions = await adapter.checkPermissions();
      if (stopRequested) {
        emit('idle', preservedDraft);
        return;
      }
      if (permissions.speechRecognition !== 'granted') {
        permissions = await adapter.requestPermissions();
      }
      if (stopRequested) {
        emit('idle', preservedDraft);
        return;
      }
      if (permissions.speechRecognition !== 'granted') {
        throw new VoiceServiceError('permission_denied', 'Microphone and speech recognition permission was denied.');
      }
      emit('idle', preservedDraft);
      completionSettled = false;
      completionPromise = new Promise<VoiceTranscriptResult | null>((resolve, reject) => {
        completionResolve = resolve;
        completionReject = reject;
      });
      // Native errors may arrive before a caller waits in stop(). Keep the
      // promise observable by stop() without allowing a rejected promise to go
      // permanently unhandled.
      void completionPromise.catch(() => undefined);
      const partialHandle = await adapter.addPartialResultsListener((event) => {
        transcript = event.accumulatedText || event.accumulated || event.matches?.[0] || transcript;
      });
      handles.push(partialHandle);
      if (stopRequested) {
        await settle(null);
        return;
      }
      const stateHandle = await adapter.addListeningStateListener((event) => {
        if (event.status === 'stopped' || event.state === 'stopped') void finishFromPlugin();
      });
      handles.push(stateHandle);
      if (stopRequested) {
        await settle(null);
        return;
      }
      const errorHandle = await adapter.addErrorListener((event) => {
        void settle(null, voiceErrorFromNative(event));
      });
      handles.push(errorHandle);
      if (stopRequested) {
        await settle(null);
        return;
      }
      emit('recording', preservedDraft);
      await adapter.start({ ...options, partialResults: true });
    } catch (error) {
      const typedError = error instanceof VoiceServiceError ? error : voiceErrorFromNative(error);
      await settle(null, typedError);
      throw typedError;
    }
  };

  const launchBegin = (options: SpeechRecognitionStartOptions, preserveTranscript = false) => {
    startPending = true;
    const pending = begin(options, preserveTranscript);
    startPromise = pending;
    void pending.then(
      () => {
        if (startPromise === pending) startPending = false;
      },
      () => {
        if (startPromise === pending) startPending = false;
      }
    );
    return pending;
  };

  return {
    get state() {
      return currentState;
    },
    async start(options) {
      if (startPending || currentState === 'recording' || currentState === 'transcribing') {
        return startPromise || Promise.resolve();
      }
      if (currentState === 'failure' || currentState === 'success') emit('idle');
      stopRequested = false;
      lastStartOptions = { ...options };
      return launchBegin(lastStartOptions);
    },
    async stop() {
      if (!startPending && (currentState === 'idle' || currentState === 'success' || currentState === 'failure')) {
        return currentResult || null;
      }
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        if (startPending) {
          stopRequested = true;
          try {
            await startPromise;
          } catch {
            return currentResult || null;
          }
          if (!isCaptureActive()) {
            await releaseCapture();
            return currentResult || null;
          }
        }
        try {
          await releaseCapture();
        } catch (error) {
          const typedError = voiceErrorFromNative(error);
          await settle(null, typedError);
          throw typedError;
        }
        return completionPromise ? await completionPromise : null;
      })();
      try {
        return await stopPromise;
      } finally {
        stopPromise = null;
      }
    },
    async retry() {
      if (retryPromise) return retryPromise;
      if (currentState !== 'failure') return;
      const pendingRetry = (async () => {
        const preservedDraft = draftResult();
        emit('idle', preservedDraft);
        stopRequested = false;
        const options = { ...(lastStartOptions || {}) };
        await launchBegin(options, true);
      })();
      retryPromise = pendingRetry;
      try {
        await pendingRetry;
      } finally {
        if (retryPromise === pendingRetry) retryPromise = null;
      }
    },
    subscribe(listener) {
      subscribers.add(listener);
      listener(snapshot());
      return () => subscribers.delete(listener);
    }
  };
}

export const voiceService = createVoiceService();
