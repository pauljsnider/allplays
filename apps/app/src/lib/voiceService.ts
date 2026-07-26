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

type NativeSpeechRecognitionPlugin = typeof import('@capgo/capacitor-speech-recognition')['SpeechRecognition'];

let nativeSpeechRecognitionPromise: Promise<NativeSpeechRecognitionPlugin> | null = null;

function loadNativeSpeechRecognition(): Promise<NativeSpeechRecognitionPlugin> {
  if (!nativeSpeechRecognitionPromise) {
    nativeSpeechRecognitionPromise = import('@capgo/capacitor-speech-recognition')
      .then((module) => module.SpeechRecognition);
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
