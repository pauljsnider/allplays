import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
  SpeechRecognition,
  type LastPartialResult,
  type SpeechRecognitionAvailability,
  type SpeechRecognitionListeningEvent,
  type SpeechRecognitionPartialResultEvent,
  type SpeechRecognitionPermissionStatus,
  type SpeechRecognitionStartOptions,
  type SpeechRecognitionErrorEvent
} from '@capgo/capacitor-speech-recognition';

export type VoiceListenerHandle = PluginListenerHandle;

export const voiceRecognition = {
  isNativeRuntime() {
    return Capacitor.isNativePlatform();
  },

  hasBrowserSupport() {
    return typeof window !== 'undefined' && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  },

  available(): Promise<SpeechRecognitionAvailability> {
    return SpeechRecognition.available();
  },

  checkPermissions(): Promise<SpeechRecognitionPermissionStatus> {
    return SpeechRecognition.checkPermissions();
  },

  requestPermissions(): Promise<SpeechRecognitionPermissionStatus> {
    return SpeechRecognition.requestPermissions();
  },

  start(options: SpeechRecognitionStartOptions) {
    return SpeechRecognition.start(options);
  },

  stop() {
    return SpeechRecognition.stop();
  },

  forceStop(options: { timeout: number }) {
    return SpeechRecognition.forceStop(options);
  },

  getLastPartialResult(): Promise<LastPartialResult> {
    return SpeechRecognition.getLastPartialResult();
  },

  addPartialResultsListener(listener: (event: SpeechRecognitionPartialResultEvent) => void): Promise<VoiceListenerHandle> {
    return SpeechRecognition.addListener('partialResults', listener);
  },

  addListeningStateListener(listener: (event: SpeechRecognitionListeningEvent) => void): Promise<VoiceListenerHandle> {
    return SpeechRecognition.addListener('listeningState', listener);
  },

  addErrorListener(listener: (event: SpeechRecognitionErrorEvent) => void): Promise<VoiceListenerHandle> {
    return SpeechRecognition.addListener('error', listener);
  }
};
