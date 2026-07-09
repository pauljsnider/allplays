import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const indexCss = readFileSync(
    path.join(process.cwd(), 'apps/app/src/styles/index.css'),
    'utf8'
);

// Tailwind v4 emits utilities inside a real `@layer utilities`. Any unlayered
// element-level rule in app CSS outranks every utility regardless of
// specificity — an unlayered `button { font: inherit }` silently disabled all
// text-size/weight utilities on buttons (oversized team tab labels on iOS).
describe('app CSS cascade layers', () => {
    it('keeps element-level resets inside @layer base', () => {
        expect(indexCss).toContain('@layer base');

        const cssWithoutComments = indexCss.replace(/\/\*[\s\S]*?\*\//g, '');
        const unlayeredTopLevelElementRules = [];
        let depth = 0;
        let buffer = '';
        for (const char of cssWithoutComments) {
            if (char === '{') {
                if (depth === 0) {
                    const selector = buffer.trim().split('\n').pop().trim();
                    if (/^([a-z][a-z0-9]*|\*|:root)([\s,].*)?$/i.test(selector) && !selector.startsWith('@')) {
                        unlayeredTopLevelElementRules.push(selector);
                    }
                }
                depth += 1;
                buffer = '';
            } else if (char === '}') {
                depth -= 1;
                buffer = '';
            } else {
                buffer += char;
            }
        }

        expect(unlayeredTopLevelElementRules).toEqual([]);
    });

    it('scopes compact team-row icon sizing to the quick-link class', () => {
        // A bare `a[aria-label]` selector also matches the row's main content
        // link, squashing it to 36px and spilling the chips out of the card.
        expect(indexCss).not.toContain('.team-launcher-row-compact a[aria-label]');
        expect(indexCss).toContain('.team-launcher-row-compact .team-quick-link');

        const teamsPage = readFileSync(
            path.join(process.cwd(), 'apps/app/src/pages/Teams.tsx'),
            'utf8'
        );
        expect(teamsPage.match(/team-quick-link/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('does not duplicate the preflight form-control font reset', () => {
        // Tailwind v4 preflight already applies `font: inherit` to buttons and
        // inputs inside @layer base; a local copy is redundant and, if ever
        // unlayered again, breaks font utilities on those elements.
        expect(indexCss).not.toMatch(/button\s*,\s*\n?\s*input\s*,\s*\n?\s*select\s*,\s*\n?\s*textarea\s*\{\s*font:\s*inherit/);
    });
});
