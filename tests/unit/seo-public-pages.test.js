import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(process.cwd());

function readRepoFile(relativePath) {
    return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

function listIndexableRootPages() {
    return readdirSync(REPO_ROOT)
        .filter((file) => file.endsWith('.html'))
        .filter((file) => !readRepoFile(file).includes('noindex'))
        .sort();
}

function extractLocEntries(sitemapXml) {
    return [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

describe('public page search metadata', () => {
    const indexablePages = listIndexableRootPages();

    it('keeps at least the core public pages indexable', () => {
        expect(indexablePages).toContain('index.html');
        expect(indexablePages).toContain('teams.html');
        expect(indexablePages).toContain('help.html');
        expect(indexablePages.length).toBeGreaterThan(10);
    });

    it('gives every indexable page a description, canonical, Open Graph, and Twitter card', () => {
        for (const file of indexablePages) {
            const html = readRepoFile(file);
            const label = `${file} should expose search metadata`;

            expect(html, label).toMatch(/<meta[^>]*name="description"[^>]*>/);
            expect(html, label).toMatch(/<link[^>]*rel="canonical"[^>]*>/);
            expect(html, label).toMatch(/property="og:type"/);
            expect(html, label).toMatch(/property="og:site_name"/);
            expect(html, label).toMatch(/property="og:title"/);
            expect(html, label).toMatch(/property="og:description"/);
            expect(html, label).toMatch(/property="og:url"/);
            expect(html, label).toMatch(/property="og:image"/);
            expect(html, label).toMatch(/name="twitter:card"/);
            expect(html, label).toMatch(/name="twitter:title"/);
            expect(html, label).toMatch(/name="twitter:description"/);
            expect(html, label).toMatch(/name="twitter:image"/);
        }
    });

    it('points canonical and og:url at the deployed site path for each page', () => {
        for (const file of indexablePages) {
            const html = readRepoFile(file);
            const expected = file === 'index.html'
                ? 'https://allplays.ai/'
                : `https://allplays.ai/${file}`;

            expect(html, `${file} canonical should match`).toContain(`rel="canonical" href="${expected}"`);
            expect(html, `${file} og:url should match`).toContain(`property="og:url" content="${expected}"`);
        }
    });

    it('uses one consistent brand image for link sharing cards', () => {
        for (const file of indexablePages) {
            const html = readRepoFile(file);
            expect(html, `${file} og:image should be brand-wide`).toContain('content="https://allplays.ai/img/logo_large.png"');
            expect(html, `${file} twitter:image should be brand-wide`).toContain('content="https://allplays.ai/img/logo_large.png"');
        }
    });

    it('lists every indexable page in sitemap.xml and no page that does not exist', () => {
        const sitemapXml = readRepoFile('sitemap.xml');
        const locEntries = extractLocEntries(sitemapXml);
        const locFiles = locEntries.map((loc) => {
            if (loc.endsWith('/')) {
                return 'index.html';
            }
            return loc.slice(loc.lastIndexOf('/') + 1);
        });

        expect(new Set(locFiles).size).toBe(locFiles.length);
        expect(locFiles.sort()).toEqual(indexablePages);

        for (const file of locFiles) {
            expect(existsSync(resolve(REPO_ROOT, file)), `${file} should exist`).toBe(true);
        }
    });
});
