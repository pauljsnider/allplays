import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readGameHtml() {
    return readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
}

function getFunctionBody(source, functionName) {
    const signature = `function ${functionName}(`;
    const start = source.indexOf(signature);
    if (start === -1) return null;

    const braceStart = source.indexOf('{', start);
    if (braceStart === -1) return null;

    let depth = 1;
    for (let i = braceStart + 1; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        if (ch === '}') depth -= 1;
        if (depth === 0) return source.slice(braceStart + 1, i);
    }

    return null;
}

describe('postgame summary editor', () => {
    it('re-enables Save Summary when the editor is opened or closed', () => {
        const body = getFunctionBody(readGameHtml(), 'setupSummaryControls');

        expect(body).toBeTruthy();
        const openEditorIndex = body.indexOf('const openEditor = (auto = false) => {');
        const closeEditorIndex = body.indexOf('const closeEditor = () => {');
        const saveDisabledIndex = body.indexOf('saveBtn.disabled = true;');
        const errorResetIndex = body.lastIndexOf('saveBtn.disabled = false;');

        expect(openEditorIndex).toBeGreaterThanOrEqual(0);
        expect(closeEditorIndex).toBeGreaterThanOrEqual(0);
        expect(saveDisabledIndex).toBeGreaterThan(closeEditorIndex);
        expect(errorResetIndex).toBeGreaterThan(saveDisabledIndex);
        expect(body.slice(openEditorIndex, closeEditorIndex)).toContain('saveBtn.disabled = false;');
        expect(body.slice(closeEditorIndex, saveDisabledIndex)).toContain('saveBtn.disabled = false;');
    });
});
