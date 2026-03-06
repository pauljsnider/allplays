import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('edit schedule practice datetime-local prefill', () => {
    it('uses local-input helper for practice start/end instead of UTC slicing', () => {
        const source = readEditSchedule();

        const startIndex = source.indexOf('function startEditPractice(practice) {');
        const endIndex = source.indexOf("document.getElementById('cancel-edit-practice-btn').addEventListener('click', resetPracticeForm);");
        expect(startIndex).toBeGreaterThanOrEqual(0);
        expect(endIndex).toBeGreaterThan(startIndex);

        const block = source.slice(startIndex, endIndex);
        expect(block).toContain("document.getElementById('practiceStart').value = formatIsoForInput(practice.date)");
        expect(block).toContain("document.getElementById('practiceEnd').value = formatIsoForInput(practice.end)");

        expect(block).not.toContain("document.getElementById('practiceStart').value = date.toISOString().slice(0, 16)");
        expect(block).not.toContain("document.getElementById('practiceEnd').value = endDate.toISOString().slice(0, 16)");
    });

    it('does not leave any editable schedule datetime-local input on raw UTC slicing', () => {
        const source = readEditSchedule();

        expect(source).toContain('function formatIsoForInput(value) {');
        expect(source).toContain('value="${formatIsoForInput(game.arrivalTime)}"');
        expect(source).toContain('value="${formatIsoForInput(date)}"');
        expect(source).not.toContain('value="${date.toISOString().slice(0, 16)}"');
    });
});
