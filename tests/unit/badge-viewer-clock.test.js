import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { getOverlayLiveClockMs } from '../../js/live-game-overlay-model.js';
import { mapScheduleEventRecord } from '../../apps/app/src/lib/firestore/mappers.ts';
import { getLiveClockViewModel } from '../../apps/app/src/lib/scheduleLogic.ts';
const core = createRequire(import.meta.url)('../../functions/badge-score-core.cjs');
const source = readFileSync(new URL('../../js/live-game.js', import.meta.url), 'utf8');
const extract = (name, next) => source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
const now = Date.parse('2026-10-31T12:00:00Z');
afterEach(() => vi.useRealTimers());

it('maps the badge epoch and keeps a running React schedule clock advancing after 10 minutes', () => {
    const started = core.apply({ liveClockMs: 1000 }, { revision: 0 }, { action: 'clock', running: true, revision: 0 }, now, 'basketball');
    const mapped = mapScheduleEventRecord({ id: 'game', date: new Date(now), ...started.next });
    expect(mapped.liveClockUpdatedAt).toEqual(new Date(now));
    expect(getLiveClockViewModel(mapped, new Date(now + 5000)).clock).toBe('00:06');
    expect(getLiveClockViewModel(mapped, new Date(now + 900000)).clock).toBe('15:01');
    const paused = core.apply(started.next, started.control, { action: 'clock', running: false, revision: 1 }, now + 900000, 'basketball');
    const stopped = mapScheduleEventRecord({ id: 'game', date: new Date(now), ...paused.next });
    expect(getLiveClockViewModel(stopped, new Date(now + 950000)).clock).toBe('15:01');
});

describe('legacy viewer clock', () => {
    it('ticks between commands, reconciles delayed events, pauses and leaves replay time untouched', () => {
        vi.useFakeTimers(); vi.setSystemTime(now);
        const state = { game: { liveStatus: 'live' }, gameClockMs: 0, isReplay: false, unsubscribers: [] };
        const els = { clock: { textContent: '' } };
        const api = new Function('state', 'els', 'window', 'getTimestampMs', 'getOverlayLiveClockMs', 'hasActiveLiveLifecycle', 'formatClock', 'startEngagements', 'startLiveEvents', 'setConnectionBanner', `${extract('syncViewerClock', 'renderScoreboard')}\n${extract('startLiveMode', 'startEngagements')}\n${extract('stopLiveMode', 'showNotLiveOverlay')}\nreturn { syncViewerClock, renderViewerClock, startLiveMode, stopLiveMode };`)(state, els, { setInterval, clearInterval }, t => typeof t === 'number' ? t : t?.toMillis?.(), getOverlayLiveClockMs, g => g.liveStatus === 'live', String, () => {}, () => {}, () => {});
        api.syncViewerClock({ type: 'clock_start', gameClockMs: 1000, createdAt: now, liveClockRunning: true });
        api.startLiveMode();
        vi.advanceTimersByTime(5000);
        expect(els.clock.textContent).toBe('6000');
        api.syncViewerClock({ type: 'clock_sync', gameClockMs: 3000, createdAt: now + 2000, liveClockRunning: true });
        api.renderViewerClock();
        expect(els.clock.textContent).toBe('6000');
        api.syncViewerClock({ type: 'period_change', gameClockMs: 6000, createdAt: now + 5000, liveClockRunning: false });
        vi.advanceTimersByTime(5000);
        expect(els.clock.textContent).toBe('6000');
        api.syncViewerClock({ type: 'clock_start', gameClockMs: 1000, createdAt: now });
        api.renderViewerClock();
        expect(els.clock.textContent).toBe('6000');
        state.isReplay = true; state.gameClockMs = 2000;
        vi.advanceTimersByTime(1000);
        expect(els.clock.textContent).toBe('2000');
        api.stopLiveMode();
        expect(vi.getTimerCount()).toBe(0);
    });
});
