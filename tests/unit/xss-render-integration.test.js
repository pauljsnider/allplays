// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../../js/utils.js';

// Integration tests: render the exact markup shapes used by the fixed sinks
// through a REAL DOM (jsdom) using the REAL escapeHtml, with malicious input,
// then assert via DOM queries that no attacker-controlled node/handler is
// created. This proves the end-to-end render path is safe, not just the string.

const ATTACK_NAMES = [
    '"><img src=x onerror="window.__xss=1">',
    "'><svg onload=\"window.__xss=1\">",
    '<script>window.__xss=1</script>',
    'Bobby"><iframe src=javascript:window.__xss=1>'
];

function render(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
}

describe('legacy XSS render integration', () => {
    it('attribute context: player name in an input value creates no extra nodes', () => {
        for (const name of ATTACK_NAMES) {
            delete window.__xss;
            // Mirrors edit-roster.html / edit-schedule.html input value sinks.
            const host = render(`<input type="text" value="${escapeHtml(name)}">`);
            const input = host.querySelector('input');
            expect(input).toBeTruthy();
            // The whole payload survives as the literal value (text), unparsed.
            expect(input.getAttribute('value')).toBe(name);
            // No injected elements, no fired handler.
            expect(host.querySelectorAll('img, svg, script, iframe')).toHaveLength(0);
            expect(window.__xss).toBeUndefined();
        }
    });

    it('alt/src attribute context: photo preview creates only the intended img', () => {
        for (const name of ATTACK_NAMES) {
            delete window.__xss;
            const url = 'https://cdn.test/p.png';
            // Mirrors edit-roster.html / player.html photo preview sinks.
            const host = render(`<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" class="x">`);
            const imgs = host.querySelectorAll('img');
            expect(imgs).toHaveLength(1); // exactly the intended one
            expect(imgs[0].getAttribute('alt')).toBe(name);
            expect(imgs[0].getAttribute('src')).toBe(url);
            expect(host.querySelectorAll('script, iframe, svg')).toHaveLength(0);
            expect(window.__xss).toBeUndefined();
        }
    });

    it('element-text context: player name in a span renders as text only', () => {
        for (const name of ATTACK_NAMES) {
            delete window.__xss;
            // Mirrors game-plan.html span sinks.
            const host = render(`<span class="n">${escapeHtml(name)}</span>`);
            const span = host.querySelector('span.n');
            expect(span).toBeTruthy();
            expect(span.textContent).toBe(name);
            expect(host.querySelectorAll('img, svg, script, iframe')).toHaveLength(0);
            expect(window.__xss).toBeUndefined();
        }
    });

    it('regression: the unescaped form WOULD have injected (sanity that the test is meaningful)', () => {
        delete window.__xss;
        const name = '"><img src=x onerror="window.__xss=1">';
        // Intentionally unescaped to confirm the assertions above can fail.
        const host = render(`<input type="text" value="${name}">`);
        // jsdom does not execute inline handlers, but the injected node exists.
        expect(host.querySelectorAll('img').length).toBeGreaterThan(0);
    });
});
