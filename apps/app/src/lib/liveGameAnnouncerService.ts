const DEFAULT_STORAGE_KEY = 'allplaysPlayAnnouncerEnabled';

export interface LiveGameAnnouncementEvent {
  id?: string;
  type?: string;
  period?: string;
  gameClockMs?: number;
  createdAt?: { toMillis?: () => number } | number | string;
  description?: string;
  replayOnly?: boolean;
}

export interface PlayAnnouncerOptions {
  speechSynthesis?: SpeechSynthesis | null;
  SpeechSynthesisUtterance?: typeof globalThis.SpeechSynthesisUtterance;
  storage?: Storage | null;
  storageKey?: string;
}

export interface AnnounceOptions {
  allowReplay?: boolean;
  playbackSessionId?: string;
}

export function cleanAnnouncementText(value: unknown): string {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildPlayAnnouncement(event: LiveGameAnnouncementEvent = {}): string {
  const description = cleanAnnouncementText(event.description);
  if (!description) return '';

  const period = cleanAnnouncementText(event.period);
  const parts: string[] = [];
  if (period) parts.push(period);
  parts.push(description);

  return parts.join('. ');
}

function safeGetStorage(storage: Storage | null | undefined, key: string): string | null {
  try {
    return storage?.getItem?.(key) || null;
  } catch {
    return null;
  }
}

function safeSetStorage(storage: Storage | null | undefined, key: string, value: string): void {
  try {
    storage?.setItem?.(key, value);
  } catch {
    // Ignore storage failures in private browsing or restricted contexts.
  }
}

function getCreatedAtValue(createdAt: LiveGameAnnouncementEvent['createdAt']): string | number {
  if (createdAt && typeof createdAt === 'object' && typeof createdAt.toMillis === 'function') {
    return createdAt.toMillis();
  }
  if (createdAt && typeof createdAt === 'object') {
    return '';
  }
  return createdAt ?? '';
}

function getAnnouncementEventKey(event: LiveGameAnnouncementEvent = {}, playbackSessionId = 'live'): string {
  const sessionKey = cleanAnnouncementText(playbackSessionId) || 'live';
  if (event.id) return `${sessionKey}:${String(event.id)}`;
  return [
    sessionKey,
    event.type || '',
    event.period || '',
    event.gameClockMs ?? '',
    getCreatedAtValue(event.createdAt),
    cleanAnnouncementText(event.description)
  ].join('|');
}

export function createPlayAnnouncer({
  speechSynthesis = globalThis.speechSynthesis,
  SpeechSynthesisUtterance = globalThis.SpeechSynthesisUtterance,
  storage = globalThis.localStorage,
  storageKey = DEFAULT_STORAGE_KEY
}: PlayAnnouncerOptions = {}) {
  const announcedEventIds = new Set<string>();
  const supported = Boolean(speechSynthesis && SpeechSynthesisUtterance);
  let enabled = safeGetStorage(storage, storageKey) === 'true';
  let paused = false;

  function persist() {
    safeSetStorage(storage, storageKey, enabled ? 'true' : 'false');
  }

  function cancelCurrentSpeech() {
    if (!supported) return;
    try {
      speechSynthesis?.cancel();
    } catch {
      // Ignore browser speech engine failures.
    }
  }

  return {
    isSupported() {
      return supported;
    },
    isEnabled() {
      return enabled;
    },
    isPaused() {
      return paused;
    },
    setEnabled(nextEnabled: boolean) {
      enabled = Boolean(nextEnabled) && supported;
      if (enabled) {
        paused = false;
      } else {
        paused = false;
        cancelCurrentSpeech();
      }
      persist();
      return enabled;
    },
    setPaused(nextPaused: boolean) {
      paused = Boolean(nextPaused) && enabled;
      if (paused) {
        cancelCurrentSpeech();
      }
      return paused;
    },
    clearHistory() {
      announcedEventIds.clear();
    },
    announceEvent(event: LiveGameAnnouncementEvent, { allowReplay = true, playbackSessionId = 'live' }: AnnounceOptions = {}) {
      if (!supported || !enabled || paused) return false;
      if (!allowReplay && event?.replayOnly) return false;
      const eventId = getAnnouncementEventKey(event, playbackSessionId);
      if (eventId && announcedEventIds.has(eventId)) return false;
      const text = buildPlayAnnouncement(event);
      if (!text) return false;

      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1;
        utterance.pitch = 1;
        speechSynthesis?.speak(utterance);
        if (eventId) announcedEventIds.add(eventId);
        return true;
      } catch {
        return false;
      }
    }
  };
}
