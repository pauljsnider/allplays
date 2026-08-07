import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(file) {
    return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('marketing pages integration', () => {
    describe('index.html homepage', () => {
        const html = read('index.html');

        it('keeps the live and replay discovery containers with loading placeholders', () => {
            // These IDs + placeholders are the contract homepage.js fills; losing them breaks live/replay loading.
            expect(html).toContain('id="live-games-list"');
            expect(html).toContain('id="past-games-list"');
            expect(html).toContain('Loading games...');
            expect(html).toContain('Loading replays...');
        });

        it('boots the shared header and homepage loader without a top-level Firebase import', () => {
            expect(html).toContain('id="header-container"');
            expect(html).toContain('id="hero-cta"');
            expect(html).toContain("renderHeader(document.getElementById('header-container'), null)");
            expect(html).toContain('./js/homepage.js?v=5');
            expect(html).toContain('./js/public-homepage-games.js?v=2');
            expect(html).toContain('getHomepageGames: getPublicHomepageGames');
            // auth.js must be imported dynamically (not statically at the top of the module) so the header
            // still renders when Firebase is unavailable (e.g. localhost); a static import throws and blanks the page.
            expect(html).not.toMatch(/import\s+\{[^}]*checkAuth[^}]*\}\s+from\s+'\.\/js\/auth\.js/);
            expect(html).toMatch(/import\('\.\/js\/auth\.js\?v=\d+'\)/);
        });

        it('uses marketing-friendly language and the updated AI-actions stat', () => {
            expect(html).not.toMatch(/competitor/i);
            expect(html).toContain('>100+</div>');
            expect(html).toContain('ALL PLAYS connected');
        });

        it('links to the compare and app pages from the page body', () => {
            expect(html).toContain('href="compare.html"');
            expect(html).toContain('href="app.html"');
        });
    });

    describe.each(['compare.html', 'about.html', 'app.html'])('%s', (file) => {
        const html = read(file);

        it('renders the shared site header via renderHeader', () => {
            expect(html).toContain('id="header-container"');
            expect(html).toContain("renderHeader(document.getElementById('header-container'), null)");
        });

        it('includes the footer bottom nav linking the marketing pages', () => {
            expect(html).toContain('>Company</h4>');
            expect(html).toContain('href="about.html"');
            expect(html).toContain('href="compare.html"');
            expect(html).toContain('href="app.html"');
            // shared-footer contract (kept in sync with js/utils.js renderFooter)
            expect(html).toContain('<li><a href="help.html" class="hover:text-white transition">Help Center</a></li>');
        });

        it('avoids the word competitor', () => {
            expect(html).not.toMatch(/competitor/i);
        });

        it('has no dead placeholder links', () => {
            expect(html).not.toContain('href="#"');
        });
    });
});
