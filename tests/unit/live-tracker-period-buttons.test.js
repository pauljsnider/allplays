import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { getSportPeriodLabels } from '../../js/live-sport-config.js';

const liveTrackerHtml = readFileSync(new URL('../../live-tracker.html', import.meta.url), 'utf8');
const liveTrackerSource = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
const setPeriodSource = liveTrackerSource.match(
    /function setPeriod\(p\) \{[\s\S]*?\n\}(?=\n\nfunction applyPeriodButtons)/
)?.[0];

function createSetPeriod({
    state,
    liveState,
    addLog,
    persistLocalTrackerState,
    syncClockToGameDoc,
    broadcastEvent,
    baseLiveEvent,
    renderHeader
}) {
    if (!setPeriodSource) {
        throw new Error('Unable to extract setPeriod from live tracker source');
    }

    return new Function(
        'state',
        'document',
        'liveState',
        'addLog',
        'persistLocalTrackerState',
        'syncClockToGameDoc',
        'broadcastEvent',
        'baseLiveEvent',
        'renderHeader',
        `${setPeriodSource}\nreturn setPeriod;`
    )(
        state, { querySelectorAll: () => [] }, liveState, addLog,
        persistLocalTrackerState, syncClockToGameDoc, broadcastEvent,
        baseLiveEvent, renderHeader
    );
}

describe('live tracker period selector', () => {
    it('keeps overtime and extra-period sport labels available in config', () => {
        expect(getSportPeriodLabels({ sport: 'soccer' })).toEqual(['H1', 'H2', 'ET1', 'ET2', 'PK']);
        expect(getSportPeriodLabels({ sport: 'basketball' })).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'OT']);
    });

    it('renders period buttons from configured labels instead of a four-button template', () => {
        expect(liveTrackerHtml).toContain('id="period-buttons"');
        expect(liveTrackerHtml).not.toContain('data-period="Q1"');
        expect(liveTrackerSource).not.toContain('.slice(0, 5)');
        expect(liveTrackerSource).toContain('const resolvedLabels = labels.length ? labels : [fallbackLabel];');
        expect(liveTrackerSource).toContain('els.periodButtons.innerHTML = resolvedLabels.map((label) => `');
        expect(liveTrackerSource).toContain("button.addEventListener('click', () => setPeriod(button.dataset.period));");
    });

    it('persists, synchronizes, and broadcasts a paused period change', () => {
        const state = {
            period: 'Q1',
            running: false,
            clock: 600000
        };
        const addLog = vi.fn();
        const persistLocalTrackerState = vi.fn();
        const syncClockToGameDoc = vi.fn();
        const broadcastEvent = vi.fn();
        const baseLiveEvent = vi.fn(event => ({
            period: state.period,
            gameClockMs: state.clock,
            ...event
        }));
        const renderHeader = vi.fn();
        const setPeriod = createSetPeriod({
            state,
            liveState: { isLive: true },
            addLog,
            persistLocalTrackerState,
            syncClockToGameDoc,
            broadcastEvent,
            baseLiveEvent,
            renderHeader
        });

        setPeriod('Q2');

        expect(state.period).toBe('Q2');
        expect(addLog).toHaveBeenCalledOnce();
        expect(addLog).toHaveBeenCalledWith('Period changed: Q1 → Q2');
        expect(persistLocalTrackerState).toHaveBeenCalledOnce();
        expect(syncClockToGameDoc).toHaveBeenCalledOnce();
        expect(broadcastEvent).toHaveBeenCalledOnce();
        expect(broadcastEvent).toHaveBeenCalledWith(expect.objectContaining({
            type: 'period_change',
            period: 'Q2',
            gameClockMs: 600000
        }));
        expect(renderHeader).toHaveBeenCalledOnce();
    });

    it('does not repeat change side effects when the period is unchanged', () => {
        const state = {
            period: 'Q2',
            running: false,
            clock: 600000
        };
        const addLog = vi.fn();
        const syncClockToGameDoc = vi.fn();
        const broadcastEvent = vi.fn();
        const renderHeader = vi.fn();
        const setPeriod = createSetPeriod({
            state,
            liveState: { isLive: true },
            addLog,
            persistLocalTrackerState: vi.fn(),
            syncClockToGameDoc,
            broadcastEvent,
            baseLiveEvent: vi.fn(event => ({ period: state.period, ...event })),
            renderHeader
        });

        setPeriod('Q2');

        expect(addLog).not.toHaveBeenCalled();
        expect(syncClockToGameDoc).not.toHaveBeenCalled();
        expect(broadcastEvent).not.toHaveBeenCalled();
        expect(renderHeader).toHaveBeenCalledOnce();
    });
});
