const DEFAULT_STORAGE_KEY = 'allplaysPlayAnnouncerEnabled';

export function cleanAnnouncementText(value) {
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

export function buildPlayAnnouncement(event = {}) {
    const description = cleanAnnouncementText(event.description);
    if (!description) return '';

    const period = cleanAnnouncementText(event.period);
    const parts = [];
    if (period) parts.push(period);
    parts.push(description);

    return parts.join('. ');
}

function safeGetStorage(storage, key) {
    try {
        return storage?.getItem?.(key) || null;
    } catch {
        return null;
    }
}

function safeSetStorage(storage, key, value) {
    try {
        storage?.setItem?.(key, value);
    } catch {
        // Ignore storage failures in private browsing or restricted contexts.
    }
}

function getAnnouncementEventKey(event = {}) {
    if (event.id) return String(event.id);
    const timestamp = event.createdAt?.toMillis?.() ?? event.createdAt ?? '';
    return [event.type || '', event.period || '', event.gameClockMs ?? '', timestamp, cleanAnnouncementText(event.description)].join('|');
}

export function createPlayAnnouncer({
    speechSynthesis = globalThis.speechSynthesis,
    SpeechSynthesisUtterance = globalThis.SpeechSynthesisUtterance,
    storage = globalThis.localStorage,
    storageKey = DEFAULT_STORAGE_KEY
} = {}) {
    const announcedEventIds = new Set();
    const supported = Boolean(speechSynthesis && SpeechSynthesisUtterance);
    let enabled = safeGetStorage(storage, storageKey) === 'true';
    let paused = false;

    function persist() {
        safeSetStorage(storage, storageKey, enabled ? 'true' : 'false');
    }

    function cancelCurrentSpeech() {
        if (!supported) return;
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
        setEnabled(nextEnabled) {
            enabled = Boolean(nextEnabled) && supported;
            if (!enabled) {
                paused = false;
                cancelCurrentSpeech();
            }
            persist();
            return enabled;
        },
        setPaused(nextPaused) {
            paused = Boolean(nextPaused) && enabled;
            if (paused) {
                cancelCurrentSpeech();
            }
            return paused;
        },
        clearHistory() {
            announcedEventIds.clear();
        },
        announceEvent(event, { allowReplay = true } = {}) {
            if (!supported || !enabled || paused) return false;
            if (!allowReplay && event?.replayOnly) return false;
            const eventId = getAnnouncementEventKey(event);
            if (eventId && announcedEventIds.has(eventId)) return false;
            const text = buildPlayAnnouncement(event);
            if (!text) return false;
            if (eventId) announcedEventIds.add(eventId);

            try {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.rate = 1;
                utterance.pitch = 1;
                speechSynthesis.speak(utterance);
                return true;
            } catch {
                return false;
            }
        }
    };
}
