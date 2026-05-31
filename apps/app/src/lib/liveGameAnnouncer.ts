import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameReportPlay } from './gameReportService';

const DEFAULT_STORAGE_KEY = 'allplaysPlayAnnouncerEnabled';

export function cleanAnnouncementText(value: unknown) {
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

export function buildPlayAnnouncement(play: Partial<GameReportPlay> = {}) {
  const period = cleanAnnouncementText(play.period);
  const clock = cleanAnnouncementText(play.clock);
  const text = cleanAnnouncementText(play.text);
  const parts = [period, clock, text].filter(Boolean);
  return parts.join('. ');
}

function safeGetStorage(storage: Storage | Pick<Storage, 'getItem'> | undefined, key: string) {
  try {
    return storage?.getItem?.(key) || null;
  } catch {
    return null;
  }
}

function safeSetStorage(storage: Storage | Pick<Storage, 'setItem'> | undefined, key: string, value: string) {
  try {
    storage?.setItem?.(key, value);
  } catch {
    // Ignore storage failures in private or restricted browsing contexts.
  }
}

export function getAnnouncementEventKey(play: Partial<GameReportPlay> = {}) {
  if (play.id) return String(play.id);
  return [play.period || '', play.clock || '', cleanAnnouncementText(play.text)].join('|');
}

export function createPlayAnnouncer({
  speechSynthesis = typeof window !== 'undefined' ? window.speechSynthesis : undefined,
  SpeechSynthesisUtterance = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : undefined,
  storage = typeof window !== 'undefined' ? window.localStorage : undefined,
  storageKey = DEFAULT_STORAGE_KEY
}: {
  speechSynthesis?: Pick<SpeechSynthesis, 'cancel' | 'speak'>;
  SpeechSynthesisUtterance?: typeof globalThis.SpeechSynthesisUtterance;
  storage?: Storage | Pick<Storage, 'getItem' | 'setItem'>;
  storageKey?: string;
} = {}) {
  const announcedEventIds = new Set<string>();
  const supported = Boolean(speechSynthesis && SpeechSynthesisUtterance);
  let enabled = safeGetStorage(storage, storageKey) === 'true' && supported;
  let paused = false;

  function persist() {
    safeSetStorage(storage, storageKey, enabled ? 'true' : 'false');
  }

  function cancelCurrentSpeech() {
    if (!supported || !speechSynthesis) return;
    try {
      speechSynthesis.cancel();
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
      if (!enabled) {
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
    announceEvent(play: Partial<GameReportPlay>) {
      if (!supported || !enabled || paused) return false;
      const eventKey = getAnnouncementEventKey(play);
      if (eventKey && announcedEventIds.has(eventKey)) return false;
      const text = buildPlayAnnouncement(play);
      if (!text) return false;

      if (!SpeechSynthesisUtterance || !speechSynthesis) return false;

      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1;
        utterance.pitch = 1;
        speechSynthesis.speak(utterance);
        if (eventKey) announcedEventIds.add(eventKey);
        return true;
      } catch {
        return false;
      }
    }
  };
}

export function useLiveGameAnnouncer(plays: GameReportPlay[]) {
  const announcer = useMemo(() => createPlayAnnouncer(), []);
  const [enabled, setEnabled] = useState(() => announcer.isEnabled());
  const [paused, setPaused] = useState(() => announcer.isPaused());
  const supported = announcer.isSupported();
  const seenEventKeysRef = useRef<Set<string>>(new Set());
  const hasSeededInitialEventsRef = useRef(false);

  const toggleEnabled = useCallback(() => {
    const nextEnabled = announcer.setEnabled(!enabled);
    setEnabled(nextEnabled);
    setPaused(announcer.isPaused());
  }, [announcer, enabled]);

  useEffect(() => {
    if (!supported || typeof document === 'undefined') return undefined;

    const syncVisibility = () => {
      const nextPaused = announcer.setPaused(document.hidden);
      setPaused(nextPaused);
    };

    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      const nextPaused = announcer.setPaused(true);
      setPaused(nextPaused);
    };
  }, [announcer, supported]);

  useEffect(() => {
    const eventKeys = plays.map((play) => getAnnouncementEventKey(play)).filter(Boolean);
    if (!hasSeededInitialEventsRef.current) {
      seenEventKeysRef.current = new Set(eventKeys);
      hasSeededInitialEventsRef.current = true;
      return;
    }

    const nextSeenKeys = new Set(seenEventKeysRef.current);
    plays.forEach((play) => {
      const eventKey = getAnnouncementEventKey(play);
      if (eventKey && !nextSeenKeys.has(eventKey)) {
        announcer.announceEvent(play);
        nextSeenKeys.add(eventKey);
      }
    });
    seenEventKeysRef.current = nextSeenKeys;
  }, [announcer, plays]);

  return {
    supported,
    enabled,
    paused,
    toggleEnabled
  };
}
