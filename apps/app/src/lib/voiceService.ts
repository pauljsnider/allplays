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

/**
 * Bounded speech-capture lifecycle. The service exposes transcripts only; the
 * native plugin owns microphone buffers and they are never retained or emitted.
 */
export function createVoiceService(adapter: VoiceRecognitionAdapter = voiceRecognition): VoiceService {
  let currentState: VoiceServiceState = 'idle';
  let currentError: VoiceServiceError | undefined;
  let currentResult: VoiceTranscriptResult | undefined;
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<VoiceTranscriptResult | null> | null = null;
  let completionSettled = false;
  let completionResolve: ((result: VoiceTranscriptResult | null) => void) | null = null;
  let completionReject: ((error: VoiceServiceError) => void) | null = null;
  let completionPromise: Promise<VoiceTranscriptResult | null> | null = null;
  let transcript = '';
  let handles: VoiceListenerHandle[] = [];
  const subscribers = new Set<(snapshot: VoiceServiceSnapshot) => void>();

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

  const settle = async (result: VoiceTranscriptResult | null, error?: VoiceServiceError) => {
    if (completionSettled) return;
    completionSettled = true;
    await removeListeners();
    if (error) {
      emit('failure', undefined, error);
      completionReject?.(error);
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
      await settle(null, voiceErrorFromNative(error));
    }
  };

  const begin = async (options: SpeechRecognitionStartOptions) => {
    emit('permission');
    try {
      const available = await adapter.available();
      if (!available.available) {
        throw new VoiceServiceError('unavailable', 'Voice recognition is not available on this device.');
      }
      let permissions = await adapter.checkPermissions();
      if (permissions.speechRecognition !== 'granted') {
        permissions = await adapter.requestPermissions();
      }
      if (permissions.speechRecognition !== 'granted') {
        throw new VoiceServiceError('permission_denied', 'Microphone and speech recognition permission was denied.');
      }
      emit('idle');
      transcript = '';
      completionSettled = false;
      completionPromise = new Promise<VoiceTranscriptResult | null>((resolve, reject) => {
        completionResolve = resolve;
        completionReject = reject;
      });
      const partialHandle = await adapter.addPartialResultsListener((event) => {
        transcript = event.accumulatedText || event.accumulated || event.matches?.[0] || transcript;
      });
      const stateHandle = await adapter.addListeningStateListener((event) => {
        if (event.status === 'stopped' || event.state === 'stopped') void finishFromPlugin();
      });
      const errorHandle = await adapter.addErrorListener((event) => {
        void settle(null, voiceErrorFromNative(event));
      });
      handles = [partialHandle, stateHandle, errorHandle];
      emit('recording');
      await adapter.start({ ...options, partialResults: true });
    } catch (error) {
      const typedError = error instanceof VoiceServiceError ? error : voiceErrorFromNative(error);
      await settle(null, typedError);
      throw typedError;
    }
  };

  return {
    get state() {
      return currentState;
    },
    async start(options) {
      if (startPromise && (currentState === 'permission' || currentState === 'recording' || currentState === 'transcribing')) {
        return startPromise || Promise.resolve();
      }
      if (currentState === 'failure' || currentState === 'success') emit('idle');
      startPromise = begin(options);
      return startPromise;
    },
    async stop() {
      if (currentState === 'idle' || currentState === 'permission' || currentState === 'success' || currentState === 'failure') {
        return currentResult || null;
      }
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        try {
          await adapter.forceStop({ timeout: 1200 });
        } catch {
          await adapter.stop();
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
      if (currentState !== 'failure') return;
      emit('idle');
      await this.start({ partialResults: true });
    },
    subscribe(listener) {
      subscribers.add(listener);
      listener(snapshot());
      return () => subscribers.delete(listener);
    }
  };
}

export const voiceService = createVoiceService();
