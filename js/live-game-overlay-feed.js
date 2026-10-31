// The listener's newest-20 window is not an authoritative deletion feed.
// Complete, bounded history refreshes reconcile older removals separately.
export function createOverlayEventHistory({ maxEvents = 2000 } = {}) {
    let rows = new Map();
    let revision = 0;
    let incomplete = false;
    const tombstones = new Map();
    const timestamp = row => {
        if (typeof row.createdAt?.toMillis === 'function') return row.createdAt.toMillis();
        const numeric = Number(row.createdAt);
        return Number.isFinite(numeric) ? numeric : Date.parse(row.createdAt) || 0;
    };
    return {
        get revision() { return revision; },
        get incomplete() { return incomplete; },
        version(id) { return rows.get(id)?.revision; },
        uncertain(incoming, startedAtRevision) {
            const ids = new Set(incoming.map(row => row.id));
            return [...rows].filter(([id, entry]) => entry.revision > startedAtRevision && !ids.has(id))
                .map(([id]) => id);
        },
        confirm(id, row, expectedRevision) {
            // Capacity-evicted rows are deliberately untracked. A delayed
            // positive point read must not reinsert them beyond the history cap.
            if (expectedRevision === undefined || rows.get(id)?.revision !== expectedRevision) return;
            revision += 1;
            if (row) { rows.set(id, { row, revision }); tombstones.delete(id); }
            else { rows.delete(id); tombstones.set(id, revision); }
            if (tombstones.size > maxEvents) tombstones.delete(tombstones.keys().next().value);
        },
        values() { return [...rows.values()].map(entry => entry.row); },
        window(incoming) {
            let next = new Map(rows);
            const nextRevision = revision + 1;
            for (const row of incoming) {
                next.set(row.id, { row, revision: nextRevision });
                tombstones.delete(row.id);
            }
            if (next.size > maxEvents) {
                // Keep live delivery moving even when full historical totals no
                // longer fit. The controller must expose the incomplete status.
                next = new Map([...next].sort(([, a], [, b]) => timestamp(a.row) - timestamp(b.row))
                    .slice(-maxEvents));
                incomplete = true;
            }
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
            for (const [id, removedAt] of tombstones) {
                if (removedAt > startedAtRevision) next.delete(id);
                else tombstones.delete(id);
            }
            if (next.size > maxEvents) throw new Error('overlay/history-limit');
            rows = next;
            incomplete = false;
            return this.values();
        }
    };
}

export function createOverlayFeedController({ subscribeEvents, subscribeChat, loadHistory, readEvents,
    onEvents, onChat, onError, onReady, onInvalidate, onFreshness = () => {}, refreshMs = 300000,
    now = Date.now, isVisible = () => true, schedule = setInterval, unschedule = clearInterval }) {
    let generation = 0;
    let stopped = true;
    let principal;
    let history = createOverlayEventHistory();
    let loading = false;
    let historyFailures = 0;
    let timer;
    let lastAttempt = -Infinity;
    let lastConfirmedAt = 0;
    let previousWindow = new Set();
    const pendingChecks = new Map();
    let checking = false;
    let verificationFailed = false;
    let readFlight = Promise.resolve();
    // Full scans and selective checks share one lane: a scan cannot revise row
    // versions underneath an in-flight deletion check. Listener delivery stays live.
    const serialRead = operation => {
        const task = readFlight.then(operation);
        readFlight = task.catch(() => {});
        return task;
    };
    const streams = { events: null, chat: null };
    const tokens = { events: 0, chat: 0 };
    const failed = new Set();
    const terminal = new Set();
    const retryCounts = { events: 0, chat: 0 };
    const deny = error => /permission-denied|unauthenticated/.test(String(error?.code || ''));
    const status = () => onFreshness({ lastConfirmedAt, loading, verifying: !verificationFailed && (checking || pendingChecks.size > 0),
        visible: isVisible(), failed: historyFailures > 0 || verificationFailed });

    async function verifyPending() {
        if (!readEvents || stopped || checking || !isVisible() || terminal.has('verification') || !pendingChecks.size) return;
        checking = true;
        status();
        const epoch = generation;
        const checks = [...pendingChecks].slice(0, 20);
        checks.forEach(([id]) => pendingChecks.delete(id));
        try {
            const { results, versions } = await serialRead(async () => {
                const versions = new Map(checks.map(([id]) => [id, history.version(id)]));
                const cancelled = () => stopped || generation !== epoch || !isVisible();
                return { versions, results: cancelled() ? [] : await readEvents(checks.map(([id]) => id), cancelled) };
            });
            if (stopped || generation !== epoch) return;
            if (!isVisible()) { checks.forEach(([id, version]) => pendingChecks.set(id, version)); return; }
            for (const result of results) history.confirm(result.id, result.row, versions.get(result.id));
            onEvents(history.values());
            if (!verificationFailed) onReady('verification');
        } catch (error) {
            if (!stopped && generation === epoch) {
                verificationFailed = true;
                if (deny(error)) terminal.add('verification');
                onError('verification', error);
            }
        } finally {
            checking = false;
            status();
            if (!stopped && pendingChecks.size) void verifyPending();
        }
    }

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
                if (kind === 'events') {
                    onEvents(history.window(rows));
                    const nextWindow = new Set(rows.map(row => row.id));
                    for (const id of previousWindow) {
                        if (!nextWindow.has(id)) pendingChecks.set(id, history.version(id));
                    }
                    previousWindow = nextWindow;
                    // A bounded selective point-read lane distinguishes eviction
                    // from deletion; it never runs more than one batch at a time.
                    if (pendingChecks.size > 2000) {
                        pendingChecks.clear();
                        verificationFailed = true;
                        onError('verification', new Error('overlay/verification-limit'));
                    }
                    void verifyPending();
                    if (history.incomplete) onError('history', new Error('overlay/history-limit'));
                }
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

    async function refresh({ force = true } = {}) {
        status();
        if (stopped || loading || !isVisible() || terminal.has('history') || historyFailures >= 3 ||
            (!force && now() - lastAttempt < refreshMs)) return;
        const epoch = generation;
        loading = true;
        status();
        try {
            await serialRead(async () => {
                if (stopped || generation !== epoch || !isVisible()) return;
                lastAttempt = now();
                const startedAtRevision = history.revision;
                const rows = await loadHistory(() => stopped || generation !== epoch || !isVisible());
                if (stopped || epoch !== generation) return;
                if (!isVisible()) { lastAttempt = -Infinity; return; }
                // A newer row omitted by this scan may be an insert or a deletion.
                // Confirm a bounded overlap set instead of preserving it indefinitely.
                const uncertain = history.uncertain(rows, startedAtRevision);
                if (readEvents && uncertain.length) {
                    if (uncertain.length > 20) throw new Error('overlay/history-busy');
                    const versions = new Map(uncertain.map(id => [id, history.version(id)]));
                    const results = await readEvents(uncertain, () => stopped || generation !== epoch || !isVisible());
                    if (stopped || epoch !== generation || !isVisible()) return;
                    for (const result of results) history.confirm(result.id, result.row, versions.get(result.id));
                }
                onEvents(history.replace(rows, startedAtRevision));
                historyFailures = 0;
                lastConfirmedAt = now();
                verificationFailed = false;
                onReady('history');
                onReady('verification');
            });
        } catch (error) {
            if (!stopped && epoch === generation) {
                historyFailures += 1;
                if (deny(error)) terminal.add('history');
                onError('history', error);
            }
        } finally {
            loading = false;
            status();
            if (!stopped && epoch !== generation) void refresh({ force: false });
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
    }

    function start() {
        if (!stopped) return;
        stopped = false;
        generation += 1;
        history = createOverlayEventHistory();
        historyFailures = 0;
        lastAttempt = -Infinity;
        lastConfirmedAt = 0;
        previousWindow = new Set();
        pendingChecks.clear();
        verificationFailed = false;
        failed.clear();
        terminal.clear();
        attach('events');
        attach('chat');
        void refresh();
        timer = schedule(() => {
            status();
            if (isVisible()) { recover(); void refresh({ force: false }); }
        }, 10000);
    }

    function recover() {
        if (stopped || !isVisible()) return;
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
        resume() {
            status();
            if (stopped || !isVisible()) return;
            // A fresh online/visible signal begins a new bounded transient
            // recovery attempt; never reset permanent authorization failures.
            if (!terminal.has('history')) historyFailures = 0;
            for (const kind of failed) {
                if (!terminal.has(kind)) retryCounts[kind] = 0;
            }
            recover();
            void verifyPending();
            void refresh({ force: false });
        },
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
