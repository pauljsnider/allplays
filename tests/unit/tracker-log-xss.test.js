import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { escapeHtml } from '../../js/utils.js';

function buildRenderLog(sourcePath, nextFunctionName) {
    const source = readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
    const match = source.match(new RegExp(
        `function renderLog\\(\\) \\{([\\s\\S]*?)\\n\\}\\n\\nfunction ${nextFunctionName}\\(`
    ));
    expect(match, `renderLog should exist in ${sourcePath}`).toBeTruthy();

    return new Function('deps', `
        const { state, els, escapeHtml } = deps;
        const removeLogEntry = () => {};
        const safeDecrement = () => 0;
        const isPointsColumn = () => false;
        const renderAll = () => {};
        const scheduleScoreSync = () => {};
        const scheduleOpponentStatsSync = () => {};
        const schedulePlayerStatsSync = () => {};
        const scheduleLiveHasData = () => {};
        const liveState = { isLive: false };
        const broadcastEvent = () => {};
        const baseLiveEvent = value => value;
        const buildStatEvent = value => value;
        return function renderLog() {
${match[1]}
        };
    `);
}

function renderMaliciousLog(sourcePath, nextFunctionName) {
    const dom = new JSDOM('<div id="log"></div>');
    const log = dom.window.document.getElementById('log');
    const state = {
        log: [{
            text: 'Opp <img src=x onerror="globalThis.__trackerXss = true"> PTS +2',
            period: '<svg onload="globalThis.__periodXss = true">',
            clock: '<script>globalThis.__clockXss = true</script>',
            ts: 0,
            undoData: { isOpponent: true }
        }]
    };
    const renderLog = buildRenderLog(sourcePath, nextFunctionName)({ state, els: { log }, escapeHtml });

    renderLog();

    return { dom, log };
}

describe('basketball tracker event log HTML safety', () => {
    it.each([
        ['Beta basketball tracker', '../../js/track-basketball.js', 'saveHistory'],
        ['Live Broadcast tracker', '../../js/live-tracker.js', 'saveHistory']
    ])('%s renders opponent event payloads as text', (_label, sourcePath, nextFunctionName) => {
        const { dom, log } = renderMaliciousLog(sourcePath, nextFunctionName);

        try {
            expect(log.querySelector('img')).toBeNull();
            expect(log.querySelector('svg')).toBeNull();
            expect(log.querySelector('script')).toBeNull();
            expect(log.textContent).toContain('Opp <img src=x onerror="globalThis.__trackerXss = true"> PTS +2');
            expect(log.textContent).toContain('<svg onload="globalThis.__periodXss = true">');
            expect(log.textContent).toContain('<script>globalThis.__clockXss = true</script>');
            expect(log.innerHTML).toContain('&lt;img');
            expect(log.innerHTML).toContain('&lt;svg');
            expect(log.innerHTML).toContain('&lt;script&gt;');
        } finally {
            dom.window.close();
        }
    });

    it('cache-busts both fixed tracker entry modules', () => {
        const betaPage = readFileSync(new URL('../../track-basketball.html', import.meta.url), 'utf8');
        const livePage = readFileSync(new URL('../../live-tracker.html', import.meta.url), 'utf8');

        expect(betaPage).toContain('src="js/track-basketball.js?v=1"');
        expect(livePage).toContain('src="js/live-tracker.js?v=1"');
    });
});
