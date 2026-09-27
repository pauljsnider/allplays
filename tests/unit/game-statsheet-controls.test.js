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
    it('reveals the remove action through the shared renderer after a successful upload', () => {
        const body = getFunctionBody(readGameHtml(), 'setupStatSheetControls');

        expect(body).toBeTruthy();
        expect(body).toContain('function renderStatSheetPhoto(nextUrl, message) {');
        expect(body).toContain("uploadBtn.classList.add('hidden');");
        expect(body).toContain("removeBtn?.classList.remove('hidden');");
        expect(body).toContain("status.textContent = message;");
        expect(body).toContain("statSheetPersisted = true;\n                    if (!isAuthBoundActionCurrent(actionContext)) return;\n                    renderStatSheetPhoto(url, 'Saved.');");
        expect(body.indexOf("uploadBtn.classList.add('hidden');")).toBeLessThan(body.indexOf('status.textContent = message;'));
        expect(body.indexOf("removeBtn?.classList.remove('hidden');")).toBeLessThan(body.indexOf('status.textContent = message;'));
    });

    it('re-enables the upload button from the auth-bound removal finally block', () => {
        const body = getFunctionBody(readGameHtml(), 'setupStatSheetControls');

        expect(body).toBeTruthy();
        const removeListenerStart = body.indexOf("addAuthBoundEventListener(removeBtn, 'click'");
        expect(removeListenerStart).toBeGreaterThan(-1);

        const removeFinallyBlockStart = body.indexOf('finally {', removeListenerStart);
        expect(removeFinallyBlockStart).toBeGreaterThan(-1);

        const removeFinallyBlockEnd = body.indexOf('}, actionContext);', removeFinallyBlockStart);
        expect(removeFinallyBlockEnd).toBeGreaterThan(removeFinallyBlockStart);

        const removeFinallyBody = body.substring(removeFinallyBlockStart, removeFinallyBlockEnd);
        expect(removeFinallyBody).toContain('if (isAuthBoundActionCurrent(actionContext)) {');
        expect(removeFinallyBody).toContain('uploadBtn.disabled = false;');
    });

    it('reconciles ambiguous writes without deleting an upload whose commit state is unknown', () => {
        const body = getFunctionBody(readGameHtml(), 'setupStatSheetControls');

        expect(body).toBeTruthy();
        expect(body).toContain("return { state: 'committed', game: authoritativeGame };");
        expect(body).toContain("return { state: 'not-committed', game: authoritativeGame };");
        expect(body).toContain("return { state: 'unknown', game: authoritativeGame };");
        expect(body).toContain("if (persistenceState === 'not-committed') {");
        expect(body).toContain("persistenceState === 'unknown'");
        expect(body).toContain('The uploaded image was retained. Refresh this report before trying again.');
    });
});
