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

describe('game score sheet controls', () => {
    it('reveals the remove action immediately after a successful upload', () => {
        const body = getFunctionBody(readGameHtml(), 'setupStatSheetControls');

        expect(body).toBeTruthy();
        expect(body).toContain("uploadBtn.classList.add('hidden');");
        expect(body).toContain("removeBtn?.classList.remove('hidden');");
        expect(body.indexOf("uploadBtn.classList.add('hidden');")).toBeLessThan(body.indexOf("status.textContent = 'Saved.';"));
        expect(body.indexOf("removeBtn?.classList.remove('hidden');")).toBeLessThan(body.indexOf("status.textContent = 'Saved.';"));
    });
});
