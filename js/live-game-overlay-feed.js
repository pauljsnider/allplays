// The listener's newest-20 window is not an authoritative deletion feed.
// Complete, bounded history refreshes reconcile older removals separately.
export function createOverlayEventHistory({ maxEvents = 2000 } = {}) {
    let rows = new Map();
    let revision = 0;
    return {
        get revision() { return revision; },
        values() { return [...rows.values()].map(entry => entry.row); },
        window(incoming) {
            const next = new Map(rows);
            const nextRevision = revision + 1;
            for (const row of incoming) next.set(row.id, { row, revision: nextRevision });
            if (next.size > maxEvents) throw new Error('overlay/history-limit');
            rows = next;
            revision = nextRevision;
            return this.values();
        },
        replace(incoming, startedAtRevision) {
            const next = new Map(incoming.map(row => [row.id, { row, revision: startedAtRevision }]));
            // History reads are not atomic with the listener. Newer deliveries win.
            for (const [id, entry] of rows) {
                if (entry.revision > startedAtRevision) next.set(id, entry);
            }
            if (next.size > maxEvents) throw new Error('overlay/history-limit');
            rows = next;
            return this.values();
        }
    };
}

export function createOverlayFeedController({ subscribeEvents, subscribeChat, loadHistory,
    onEvents, onChat, onError, onReady, onInvalidate, refreshMs = 60000,
    schedule = setInterval, unschedule = clearInterval }) {
    let generation = 0;
    let stopped = true;
    let principal;
    let history = createOverlayEventHistory();
    let loading = false;
    let historyFailures = 0;
    let timer;
    const streams = { events: null, chat: null };
    const tokens = { events: 0, chat: 0 };
    const failed = new Set();
    const terminal = new Set();
    const retryCounts = { events: 0, chat: 0 };
    const deny = error => /permission-denied|unauthenticated/.test(String(error?.code || ''));

    function attach(kind) {
        const epoch = generation;
        const token = ++tokens[kind];
        failed.delete(kind);
        terminal.delete(kind);
        const success = rows => {
            if (stopped || epoch !== generation || token !== tokens[kind] || failed.has(kind)) return;
            try {
                // The shared adapter omits cache metadata. Even a short initial
                // window can be cache-only; only a server history read removes rows.
                if (kind === 'events') onEvents(history.window(rows));
                else onChat(rows);
                retryCounts[kind] = 0;
                onReady(kind);
            } catch (error) { onError(kind, error); }
        };
        const error = reason => {
            if (stopped || epoch !== generation || token !== tokens[kind]) return;
            failed.add(kind);
            if (deny(reason)) terminal.add(kind);
            onError(kind, reason);
        };
        try {
            streams[kind] = kind === 'events' ? subscribeEvents(success, error) : subscribeChat(success, error);
        } catch (reason) { error(reason); }
    }

    async function refresh() {
        if (stopped || loading || terminal.has('history') || historyFailures >= 3) return;
        const epoch = generation;
        const startedAtRevision = history.revision;
        loading = true;
        try {
            const rows = await loadHistory(() => stopped || generation !== epoch);
            if (stopped || epoch !== generation) return;
            onEvents(history.replace(rows, startedAtRevision));
            historyFailures = 0;
            onReady('history');
        } catch (error) {
            if (!stopped && epoch === generation) {
                historyFailures += 1;
                if (deny(error) || error?.message === 'overlay/history-limit') terminal.add('history');
                onError('history', error);
            }
        } finally {
            if (epoch === generation) loading = false;
        }
    }

    function stop() {
        stopped = true;
        generation += 1;
        unschedule(timer);
        for (const kind of Object.keys(streams)) {
            streams[kind]?.();
            streams[kind] = null;
        }
        loading = false;
    }

    function start() {
        if (!stopped) return;
        stopped = false;
        generation += 1;
        history = createOverlayEventHistory();
        historyFailures = 0;
        failed.clear();
        terminal.clear();
        attach('events');
        attach('chat');
        void refresh();
        timer = schedule(() => { recover(); void refresh(); }, refreshMs);
    }

    function recover() {
        if (stopped) return;
        for (const kind of [...failed]) {
            // No permanent-permission retry loop. Retry transient failures at
            // most three times, only from the bounded timer/explicit resume.
            if (terminal.has(kind) || retryCounts[kind] >= 3) continue;
            retryCounts[kind] += 1;
            streams[kind]?.();
            attach(kind);
        }
    }

    return {
        start, stop, refresh, recover,
        authChanged(uid) {
            const next = uid || '';
            if (principal === next) return;
            principal = next;
            stop();
            onInvalidate();
            retryCounts.events = retryCounts.chat = 0;
            start();
        }
    };
}
