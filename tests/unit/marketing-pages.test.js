import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
            expect(html).toContain("import { bootHomepage } from './js/homepage-boot.js?v=1'");
            expect(html).toContain('return { checkAuth, getRedirectUrl, getPublicHomepageGames, initHomepage }');
            // auth.js must be imported dynamically (not statically at the top of the module) so the header
            // still renders when Firebase is unavailable (e.g. localhost); a static import throws and blanks the page.
            expect(html).not.toMatch(/import\s+\{[^}]*checkAuth[^}]*\}\s+from\s+'\.\/js\/auth\.js/);
            expect(html).toMatch(/import\('\.\/js\/auth\.js\?v=\d+'\)/);
        });

        it('uses marketing-friendly language without unsupported quantitative or exclusivity claims', () => {
            expect(html).not.toMatch(/competitor/i);
            expect(html).not.toMatch(/100\+|10K\+|The only youth sports platform|>1st|in seconds|in minutes|minutes after|every stat, every sport|every court|any phone, any sport|coordinate themselves|update themselves|tracked automatically/i);
            expect(html).toContain('AI assisted');
            expect(html).toContain('ALL PLAYS connected');
        });

        it('does not publish the uncleared stock photography', () => {
            expect(html).not.toMatch(/img\/stock-(highlight|live-basketball|live-soccer)\.jpg/);
            expect(existsSync(resolve(process.cwd(), 'img/stock-highlight.jpg'))).toBe(false);
            expect(existsSync(resolve(process.cwd(), 'img/stock-live-basketball.jpg'))).toBe(false);
            expect(existsSync(resolve(process.cwd(), 'img/stock-live-soccer.jpg'))).toBe(false);
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

    it('presents app CTAs accurately as web signup links', () => {
        const html = read('app.html');
        const signupTargets = html.match(/data-web-signup href="\/app\/#\/auth\?mode=signup"/g) || [];

        expect(signupTargets).toHaveLength(2);
        expect(html).not.toMatch(/App Store|Google Play|Free to download|iOS\s*&amp;\s*Android|QR/i);
        expect(html).toContain('These links open the ALL PLAYS web app');
    });

    it('routes signed-in visitors from the static page into the app at /app/', () => {
        // GitHub Pages serves this page at /app (extension-less resolution to app.html),
        // which shadows the React app at /app/. Signed-in users must be pushed into the
        // app so the static page remains the logged-out UX only.
        const html = read('app.html');

        expect(html).toContain("checkAuth((user) => {");
        expect(html).toContain("window.location.replace('/app/' + window.location.search + window.location.hash)");
        expect(html).not.toContain("location.replace('/app')");
        expect(html).toContain("renderHeader(document.getElementById('header-container'), null);");
        expect(html).toContain('.catch(() => {})');
    });

    it('does not publish unverified named-product comparisons', () => {
        const html = read('compare.html');

        expect(html).not.toMatch(/TeamSnap|GameChanger|SportsEngine|Spond|only platform|No one else|MUST be fact-checked/i);
        expect(html).not.toContain('<table');
    });

    it('does not publish unconfirmed biographies, family identities, titles, or photos', () => {
        const html = read('about.html');

        expect(html).not.toMatch(/Paul Snider|Robin Snider|Madison Snider|Will Snider|Max Snider|\bFounder\b|\bCEO\b|\bCOO\b|Chief Dad|family-[a-z]+\.jpg|paulsnider\.net\/images/i);
        expect(html).not.toContain('<img');
    });
});
