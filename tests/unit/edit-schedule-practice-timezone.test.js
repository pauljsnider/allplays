import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

function extractFunction(source, signature) {
    const startIndex = source.indexOf(signature);
    expect(startIndex).toBeGreaterThanOrEqual(0);

    const bodyStart = source.indexOf('{', startIndex);
    expect(bodyStart).toBeGreaterThan(startIndex);

    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(startIndex, index + 1);
            }
        }
    }

    throw new Error(`Could not extract function for signature: ${signature}`);
}

function runInTimezone(script, tz = 'America/Chicago') {
    return execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        encoding: 'utf8',
        env: {
            ...process.env,
            TZ: tz
        }
    }).trim();
}

describe('edit schedule practice datetime-local prefill', () => {
    it('formats stored practice timestamps into local datetime-local values', () => {
        const source = readEditSchedule();
        const formatIsoForInput = extractFunction(source, 'function formatIsoForInput(value) {');

        const output = runInTimezone(`
${formatIsoForInput}
console.log(formatIsoForInput('2026-01-16T00:00:00.000Z'));
        `);

        expect(output).toBe('2026-01-15T18:00');
    });

    it('prefills practice edit inputs without shifting by the timezone offset', () => {
        const source = readEditSchedule();
        const formatIsoForInput = extractFunction(source, 'function formatIsoForInput(value) {');
        const resetPracticeRecurrenceFields = extractFunction(source, 'function resetPracticeRecurrenceFields() {');
        const startEditPractice = extractFunction(source, 'function startEditPractice(practice) {');

        const output = runInTimezone(`
let editingPracticeId = null;
let editingSeriesId = null;
const elements = {};
const document = {
    getElementById(id) {
        if (!elements[id]) {
            elements[id] = {
                value: '',
                textContent: '',
                classList: {
                    add() {},
                    remove() {}
                }
            };
        }
        return elements[id];
    },
    querySelector() {
        return {
            checked: false
        };
    },
    querySelectorAll() {
        return [];
    }
};
function switchTab() {}
${formatIsoForInput}
${resetPracticeRecurrenceFields}
${startEditPractice}
startEditPractice({
    id: 'practice-1',
    title: 'Practice',
    date: '2026-01-16T00:00:00.000Z',
    end: '2026-01-16T01:30:00.000Z',
    location: 'Main Gym',
    notes: 'Keep time stable'
});
console.log(JSON.stringify({
    practiceStart: elements.practiceStart.value,
    practiceEnd: elements.practiceEnd.value,
    submitLabel: elements['submit-practice-btn'].textContent
}));
        `);

        expect(JSON.parse(output)).toEqual({
            practiceStart: '2026-01-15T18:00',
            practiceEnd: '2026-01-15T19:30',
            submitLabel: 'Update Practice'
        });
    });

    it('clears stale recurrence controls when switching from a recurring series to a one-time practice edit', () => {
        const source = readEditSchedule();
        const formatIsoForInput = extractFunction(source, 'function formatIsoForInput(value) {');
        const resetPracticeRecurrenceFields = extractFunction(source, 'function resetPracticeRecurrenceFields() {');
        const startEditPractice = extractFunction(source, 'function startEditPractice(practice) {');

        const output = runInTimezone(`
let editingPracticeId = null;
let editingSeriesId = null;
const recurrenceEndNever = { checked: false };
const dayCheckboxes = [{ value: 'MO', checked: true }, { value: 'WE', checked: true }];
const elements = {
    practiceRecurring: { checked: true },
    'recurrence-builder': {
        hidden: false,
        classList: {
            add(value) { if (value === 'hidden') this.hidden = true; },
            remove(value) { if (value === 'hidden') this.hidden = false; }
        }
    },
    recurrenceFreq: { value: 'daily' },
    recurrenceInterval: { value: 3 },
    recurrenceUntil: { value: '2026-03-01' },
    recurrenceCount: { value: '8' }
};
elements['recurrence-builder'].classList.hidden = false;
const document = {
    getElementById(id) {
        if (!elements[id]) {
            elements[id] = {
                value: '',
                checked: false,
                textContent: '',
                classList: {
                    add() {},
                    remove() {}
                }
            };
        }
        return elements[id];
    },
    querySelector(selector) {
        if (selector === 'input[name="recurrenceEnd"][value="never"]') {
            return recurrenceEndNever;
        }
        return { checked: false };
    },
    querySelectorAll(selector) {
        return selector === '.day-checkbox' ? dayCheckboxes : [];
    }
};
function switchTab() {}
${formatIsoForInput}
${resetPracticeRecurrenceFields}
${startEditPractice}
startEditPractice({
    id: 'practice-2',
    title: 'One-time practice',
    date: '2026-01-16T00:00:00.000Z',
    end: '2026-01-16T01:30:00.000Z'
});
console.log(JSON.stringify({
    recurring: elements.practiceRecurring.checked,
    recurrenceHidden: elements['recurrence-builder'].classList.hidden,
    freq: elements.recurrenceFreq.value,
    interval: elements.recurrenceInterval.value,
    days: dayCheckboxes.map((day) => day.checked),
    endNever: recurrenceEndNever.checked,
    until: elements.recurrenceUntil.value,
    count: elements.recurrenceCount.value,
    editingSeriesId
}));
        `);

        expect(JSON.parse(output)).toEqual({
            recurring: false,
            recurrenceHidden: true,
            freq: 'weekly',
            interval: 1,
            days: [false, false],
            endNever: true,
            until: '',
            count: '',
            editingSeriesId: null
        });
    });

    it('uses the shared local-input helper for editable schedule datetime-local fields', () => {
        const source = readEditSchedule();

        expect(source).toContain('function formatIsoForInput(value) {');
        expect(source).toContain("document.getElementById('practiceStart').value = formatIsoForInput(practice.date);");
        expect(source).toContain("document.getElementById('practiceEnd').value = formatIsoForInput(practice.end);");
        expect(source).toContain("document.getElementById('gameDate').value = formatIsoForInput(date);");
        expect(source).toContain("document.getElementById('arrivalTime').value = formatIsoForInput(at);");
        expect(source).not.toContain('value="${date.toISOString().slice(0, 16)}"');
    });
});
