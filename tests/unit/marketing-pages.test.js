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
            expect(html).toContain("import { bootHomepage } from './js/homepage-boot.js?v=1'");
            expect(html).toContain('./js/homepage.js?v=5');
            expect(html).toContain('./js/public-homepage-games.js?v=2');
            // auth.js must be imported dynamically (not statically at the top of the module) so the header
            // still renders when Firebase is unavailable (e.g. localhost); a static import throws and blanks the page.
            expect(html).not.toMatch(/import\s+\{[^}]*checkAuth[^}]*\}\s+from\s+'\.\/js\/auth\.js/);
            expect(html).toMatch(/import\('\.\/js\/auth\.js\?v=\d+'\)/);
        });

        it('shows the AI-capabilities stat and marketing-friendly language', () => {
            expect(html).toContain('>100+</div>');
            expect(html).toContain('>AI capabilities<');
            expect(html).not.toMatch(/competitor/i);
            expect(html).toContain('ALL PLAYS connected');
        });

        it('uses the AI-generated game imagery, not the retired stock photos', () => {
            expect(html).toContain('img/ai-basketball.jpg');
            expect(html).toContain('img/ai-soccer.jpg');
            expect(html).not.toMatch(/img\/stock-(highlight|live-basketball|live-soccer)\.(jpg|svg)/);
            expect(existsSync(resolve(process.cwd(), 'img/ai-basketball.jpg'))).toBe(true);
            expect(existsSync(resolve(process.cwd(), 'img/ai-soccer.jpg'))).toBe(true);
            // the previously-flagged Flickr stock photos must stay retired
            expect(existsSync(resolve(process.cwd(), 'img/stock-highlight.jpg'))).toBe(false);
            expect(existsSync(resolve(process.cwd(), 'img/stock-live-basketball.jpg'))).toBe(false);
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

        it('avoids the word competitor and has no dead placeholder links', () => {
            expect(html).not.toMatch(/competitor/i);
            expect(html).not.toContain('href="#"');
        });
    });

    it('points the app download CTAs at a real signup destination', () => {
        const html = read('app.html');
        expect(html).not.toContain('href="#"');
        expect(html).toContain('/app/#/auth?mode=signup');
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
        expect(html).toContain('.catch(() => {');
    });
});

describe('TV marketing availability boundaries', () => {
    it('distinguishes Roku replay access from public store availability and links existing destinations', () => {
        const home = read('index.html');
        const app = read('app.html');
        expect(home).toContain('Game replays on Roku');
        expect(home).toContain('Illustrative game imagery.');
        expect(home + app).not.toMatch(/In development|Concept preview|Private prototype|We’re developing/);
        expect(home).toContain('Roku access is through private sideloading; not listed in the Roku Channel Store.');
        expect(home).toContain('href="app.html#platforms"');
        expect(app).toContain('id="platforms"');
        const roku = app.match(/<article id="roku-availability"[\s\S]*?<\/article>/)[0];
        expect(roku).toContain('Watch YouTube game replays on your TV with Roku.');
        expect(roku).toContain('private sideloading; not listed in the Roku Channel Store.');
        expect(roku).not.toMatch(/live games|live streaming/i);
        expect(roku).not.toMatch(/<a\b/);
        expect(home + app).not.toMatch(/channelstore\.roku\.com|my\.roku\.com/);
        expect(app).toContain('iPhone or Android browser.');
        expect(app).not.toMatch(/App Store|Google Play|Free to download/);
        expect((app.match(/href="\/app\/#\/auth\?mode=signup"/g) || [])).toHaveLength(3);
    });
});

describe('Outcome-led vendor comparison', () => {
    it('supports the Allplays value story without false competitor gaps or install claims', () => {
        const html = read('compare.html');
        expect(html).toContain('One place for the team.');
        expect(html).toContain('Less work for you.');
        for (const vendor of ['TeamSnap', 'GameChanger', 'SportsEngine', 'Spond', 'Hudl']) {
            expect(html).toContain(`ALL PLAYS vs. ${vendor}`);
        }
        expect(html).toContain('private sideloading; not listed in the Roku Channel Store.');
        expect(html).toContain('Hudl Fan supports Roku');
        expect(html).toContain('most sports use human analysts');
        expect(html).toContain('remain proposed');
        expect(html).toContain('https://www.gc.com/app-features/team-management');
        expect(html).toContain('https://www.hudl.com/products/assist/faq');
        expect(html).toContain('Request team access');
        expect(html).not.toMatch(/Not verified|In development|Concept preview|only platform|only AI-native|GameChanger doesn.t cover|min-w-\[1100px\]/);
        expect(html).toContain('it doesn’t change your team’s records');
    });
});
