type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type NativeSpeechRecognitionPlugin = {
  available: () => Promise<{ available: boolean }>;
  requestPermissions: () => Promise<{ speechRecognition?: string }>;
  start: (options?: Record<string, unknown>) => Promise<{ matches?: string[] }>;
  stop: () => Promise<void>;
  forceStop?: (options?: Record<string, unknown>) => Promise<void>;
};

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionResultEventLike {
  results: ArrayLike<{
    isFinal?: boolean;
    0?: {
      transcript?: string;
    };
  }>;
  resultIndex?: number;
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
  message?: string;
  code?: string;
}

export interface NativeSpeechDictationSession {
  stop: () => Promise<void>;
}

interface NativeSpeechDictationOptions {
  language?: string;
  onTranscript: (transcript: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

const nativeContextualStrings = [
  'ALL PLAYS',
  'schedule',
  'RSVP',
  'availability',
  'rideshare',
  'practice packet',
  'team chat',
  'match report'
];

export function getSpeechRecognitionConstructor(win: any = globalThis): SpeechRecognitionConstructor | null {
  return win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
}

export function isSpeechDictationSupported(win: any = globalThis) {
  return Boolean(getSpeechRecognitionConstructor(win));
}

export function isCapacitorNativeRuntime(win: any = globalThis) {
  const protocol = win?.location?.protocol;
  if (protocol === 'capacitor:' || protocol === 'ionic:') {
    return true;
  }

  const capacitor = win?.Capacitor;
  if (!capacitor) {
    return false;
  }

  if (typeof capacitor.isNativePlatform === 'function') {
    return capacitor.isNativePlatform();
  }

  const platform = typeof capacitor.getPlatform === 'function' ? capacitor.getPlatform() : '';
  return platform === 'ios' || platform === 'android';
}

export function appendDictationTranscript(currentText: string, transcript: string) {
  const cleanTranscript = String(transcript || '').replace(/\s+/g, ' ').trim();
  if (!cleanTranscript) {
    return currentText;
  }

  const baseText = String(currentText || '');
  if (!baseText.trim()) {
    return cleanTranscript;
  }

  return /\s$/.test(baseText) ? `${baseText}${cleanTranscript}` : `${baseText.trimEnd()} ${cleanTranscript}`;
}

export function collectFinalDictationTranscript(event: SpeechRecognitionResultEventLike) {
  const results = Array.from(event?.results || []);
  const startIndex = Math.max(0, Number.isFinite(event?.resultIndex) ? Number(event.resultIndex) : 0);

  return results
    .slice(startIndex)
    .filter((result) => result?.isFinal !== false)
    .map((result) => result?.[0]?.transcript || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getDictationErrorMessage(event: SpeechRecognitionErrorEventLike) {
  const code = String(event?.error || event?.code || '').toLowerCase();
  if (code === 'not-allowed' || code === 'permission-denied') {
    return 'Microphone access was blocked. Allow microphone access, then tap the mic again.';
  }
  if (code === 'no-speech') {
    return 'No speech was heard. Tap the mic and try again.';
  }
  if (code === 'network') {
    return 'Dictation needs a network connection right now.';
  }

  return event?.message || 'Dictation stopped before any text was captured.';
}

export function pickNativeDictationTranscript(result: { matches?: string[] } | null | undefined) {
  return String(result?.matches?.find((match) => String(match || '').trim()) || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function startNativeSpeechDictation(options: NativeSpeechDictationOptions): Promise<NativeSpeechDictationSession> {
  const { SpeechRecognition } = await import('@capgo/capacitor-speech-recognition') as { SpeechRecognition: NativeSpeechRecognitionPlugin };
  const availability = await SpeechRecognition.available();
  if (!availability.available) {
    throw new Error('Speech recognition is not available on this device.');
  }

  const permissions = await SpeechRecognition.requestPermissions();
  if (permissions.speechRecognition !== 'granted') {
    throw new Error('Microphone access was blocked. Allow microphone access, then tap the mic again.');
  }

  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    options.onEnd();
  };

  SpeechRecognition.start({
    language: options.language,
    maxResults: 1,
    prompt: 'Ask ALL PLAYS',
    partialResults: false,
    addPunctuation: true,
    contextualStrings: nativeContextualStrings
  })
    .then((result) => {
      const transcript = pickNativeDictationTranscript(result);
      if (transcript) {
        options.onTranscript(transcript);
      }
    })
    .catch((error) => {
      options.onError(getDictationErrorMessage({
        code: error?.code,
        error: error?.error,
        message: error?.message
      }));
    })
    .finally(finish);

  return {
    stop: async () => {
      try {
        await SpeechRecognition.stop();
      } catch {
        await SpeechRecognition.forceStop?.({ timeout: 1000 }).catch(() => {});
      }
    }
  };
}
