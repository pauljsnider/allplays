import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createOverlayState, reconcileOverlayLiveEvents, getOverlayLiveClockMs } from '../../js/live-game-overlay-model.js';
import { applyResetEventState, applyViewerEventToState, collectVisibleLiveEventsSequentially } from '../../js/live-game-state.js';
const source = readFileSync(new URL('../../js/live-game-overlay.js', import.meta.url), 'utf8');
const anchor = source.slice(source.indexOf('function syncLiveClockAnchor('), source.indexOf('function getOverlayReplayHref('));
it('joins ten minutes after Start and keeps its clock through the initial events and pause', () => {
    const startedAt = 1800000000000;
    vi.spyOn(Date, 'now').mockReturnValue(startedAt + 600000);
    try {
        const state = createOverlayState({game: {liveStatus: 'live', liveClockMs: 0, liveClockRunning: true, liveClockUpdatedAt: startedAt}});
        const uiState = {game: state};
        const sync = () => new Function('uiState', 'isCompletedGame', `${anchor}; syncLiveClockAnchor();`)(uiState, () => false);
        const displayed = () => getOverlayLiveClockMs({snapshotClockMs: uiState.liveClockSnapshotMs, snapshotAtMs: uiState.liveClockSnapshotAt, nowMs: Date.now(), clockRunning: state.clockRunning});
        sync();
        expect(displayed()).toBe(600000);
        const tools = {applyResetEventState, applyViewerEventToState, collectVisibleLiveEventsSequentially};
        const start = {id: 'start', type: 'clock_start', gameClockMs: 0, liveClockRunning: true, createdAt: startedAt};
        reconcileOverlayLiveEvents(state, [start], tools);
        sync();
        expect(displayed()).toBe(600000);
        reconcileOverlayLiveEvents(state, [start, {id: 'pause', type: 'clock_pause', gameClockMs: 600000, liveClockRunning: false, createdAt: Date.now()}], tools);
        sync();
        expect(displayed()).toBe(600000);
    } finally { vi.restoreAllMocks(); }
});
