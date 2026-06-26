import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { applySubstitution } from '../../js/live-tracker-integrity.js';

const source = readFileSync(new URL('../../js/track-basketball.js', import.meta.url), 'utf8');

function extractFunction(sourceText, name) {
    const start = sourceText.indexOf(`function ${name}`);
    if (start === -1) {
        throw new Error(`Function ${name} not found`);
    }

    const bodyStart = sourceText.indexOf('{', start);
    let depth = 0;

    for (let index = bodyStart; index < sourceText.length; index += 1) {
        const char = sourceText[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return sourceText.slice(start, index + 1);
        }
    }

    throw new Error(`Function ${name} did not terminate`);
}

function createHooks() {
    const factory = new Function('applySubstitution', `
let subSequence = 0;
let roster = [
    { id: 'p1', num: '1', name: 'Ava' },
    { id: 'p2', num: '2', name: 'Bea' },
    { id: 'p3', num: '3', name: 'Cam' },
    { id: 'p4', num: '4', name: 'Dia' },
    { id: 'p5', num: '5', name: 'Eli' },
    { id: 'p6', num: '6', name: 'Flo' }
];
let state = {
    period: 'Q1',
    clock: 65000,
    home: 0,
    away: 0,
    onCourt: ['p1', 'p2', 'p3', 'p4', 'p5'],
    bench: ['p6'],
    stats: {
        p1: { pts: 0, time: 0 },
        p2: { pts: 0, time: 0 },
        p3: { pts: 0, time: 0 },
        p4: { pts: 0, time: 0 },
        p5: { pts: 0, time: 0 },
        p6: { pts: 0, time: 0 }
    },
    log: [],
    subs: [],
    opp: [],
    history: [],
    scoreLogIsComplete: true
};
const els = { log: { innerHTML: '', querySelectorAll: () => [] } };
const renderLog = () => {};
const renderAll = () => {};
const renderLineup = () => {};
const renderLive = () => {};
const alert = () => {};
const isPointsColumn = () => false;
const getNum = (id) => roster.find((player) => player.id === id)?.num || '';
const playerName = (id) => roster.find((player) => player.id === id)?.name || '';
${extractFunction(source, 'formatClock')}
${extractFunction(source, 'safeDecrement')}
${extractFunction(source, 'createSubEntry')}
${extractFunction(source, 'addLog')}
${extractFunction(source, 'revertLogEntry')}
${extractFunction(source, 'removeLogEntry')}
${extractFunction(source, 'saveHistory')}
${extractFunction(source, 'undo')}
${extractFunction(source, 'applySub')}
return {
    state,
    applySub,
    removeLogEntry,
    saveHistory,
    undo
};
`);

    return factory(applySubstitution);
}

describe('track basketball substitution undo', () => {
    it('removing a substitution event restores lineup state and clears substitution history', () => {
        const hooks = createHooks();

        hooks.applySub('p1', 'p6');
        expect(hooks.state.onCourt).toContain('p6');
        expect(hooks.state.bench).toContain('p1');
        expect(hooks.state.subs).toHaveLength(1);
        expect(hooks.state.log[0].undoData).toMatchObject({
            type: 'sub',
            outId: 'p1',
            inId: 'p6'
        });

        hooks.removeLogEntry(0);

        expect(hooks.state.onCourt).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
        expect(hooks.state.bench).toEqual(['p6']);
        expect(hooks.state.subs).toEqual([]);
        expect(hooks.state.log).toEqual([]);
    });

    it('undo restores substitution history snapshots alongside lineup state', () => {
        const hooks = createHooks();
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1710000000000);

        hooks.saveHistory('Sub: #1 → #6');
        hooks.applySub('p1', 'p6');
        expect(hooks.state.subs).toHaveLength(1);

        hooks.undo();
        nowSpy.mockRestore();

        expect(hooks.state.onCourt).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
        expect(hooks.state.bench).toEqual(['p6']);
        expect(hooks.state.subs).toEqual([]);
        expect(hooks.state.log[0].text).toBe('Undid: Sub: #1 → #6');
    });
});
