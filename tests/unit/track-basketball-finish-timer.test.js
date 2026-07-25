import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../js/track-basketball.js', import.meta.url), 'utf8');

function extractFunction(name) {
    const start = source.indexOf(`function ${name}`);
    if (start === -1) {
        throw new Error(`Function ${name} not found`);
    }

    const bodyStart = source.indexOf('{', start);
    let depth = 0;

    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }

    throw new Error(`Function ${name} did not terminate`);
}

describe('track basketball finish timer', () => {
    it('pauses the timer before rendering Finish so later ticks cannot add playing time', () => {
        const clearInterval = vi.fn();
        const renderFinish = vi.fn();
        const classList = {
            toggle: vi.fn(),
            remove: vi.fn(),
            add: vi.fn()
        };
        const state = {
            running: true,
            tick: 42,
            lastTick: 1000,
            clock: 1000,
            onCourt: ['p1'],
            stats: { p1: { time: 1000 } }
        };
        const els = {
            panelLineup: { classList },
            panelLive: { classList },
            panelOpp: { classList },
            panelFin: { classList },
            startStop: { textContent: 'Pause', classList }
        };
        const performance = { now: vi.fn(() => 61000) };
        const renderHeader = vi.fn();
        const renderLive = vi.fn();
        const renderFairness = vi.fn();

        const run = new Function(
            'state',
            'els',
            'clearInterval',
            'renderFinish',
            'performance',
            'renderHeader',
            'renderLive',
            'renderFairness',
            `${extractFunction('pauseTimer')}
${extractFunction('tick')}
${extractFunction('setTab')}
setTab('finish');
tick();`
        );

        run(
            state,
            els,
            clearInterval,
            renderFinish,
            performance,
            renderHeader,
            renderLive,
            renderFairness
        );

        expect(state.running).toBe(false);
        expect(state.clock).toBe(1000);
        expect(state.stats.p1.time).toBe(1000);
        expect(clearInterval).toHaveBeenCalledWith(42);
        expect(els.startStop.textContent).toBe('Start');
        expect(renderFinish).toHaveBeenCalledOnce();
        expect(performance.now).not.toHaveBeenCalled();
    });
});
