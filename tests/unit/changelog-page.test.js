import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(resolve(REPO_ROOT, 'changelog.html'), 'utf8');

const VALID_CATS = new Set([
    'tracking', 'broadcast', 'schedule', 'roster',
    'payments', 'registration', 'media', 'ai', 'platform'
]);
const ALL_RELEASE_IDS   = ['jun-2026', 'may-2026', 'mar-2026', 'feb-2026', 'jan-2026', 'dec-2025'];
const OLDER_RELEASE_IDS = ['may-2026', 'mar-2026', 'feb-2026', 'jan-2026', 'dec-2025'];

function extractDataCatsValues(source) {
    return [...source.matchAll(/data-cats="([^"]+)"/g)].map((m) => m[1]);
}

function extractWorkflowLinkTargets(source) {
    return [
        ...new Set(
            [...source.matchAll(/href="(workflow-[^"#]+\.html)/g)].map((m) => m[1])
        )
    ];
}

describe('changelog page — release structure', () => {
    it('contains all six release sections with expected IDs', () => {
        for (const id of ALL_RELEASE_IDS) {
            expect(html, `missing release section id="${id}"`).toContain(`id="${id}"`);
        }
    });

    it('each release section has a dated label and subtitle', () => {
        expect(html).toContain('class="release-date"');
        expect(html).toContain('class="release-subtitle"');
        expect(html).toContain('May 12-June 23, 2026');
        expect(html).toContain('May 2026');
        expect(html).toContain('March 2026');
        expect(html).toContain('February 2026');
        expect(html).toContain('January 2026');
        expect(html).toContain('December 2025');
    });

    it('each release body div is keyed with the matching release id', () => {
        for (const id of ALL_RELEASE_IDS) {
            expect(html, `missing release body for ${id}`).toContain(`id="body-${id}"`);
        }
    });
});

describe('changelog page — collapse / expand default state', () => {
    it('jun-2026 release body starts expanded (no collapsed class)', () => {
        // The collapsed body pattern must NOT appear for the latest release.
        expect(html).not.toMatch(/class="release-body collapsed"\s+id="body-jun-2026"/);
        expect(html).not.toMatch(/id="body-jun-2026"\s+class="release-body collapsed"/);
        expect(html).toContain('id="body-jun-2026"');
    });

    it('older release bodies start collapsed', () => {
        for (const id of OLDER_RELEASE_IDS) {
            expect(html, `${id} body should start collapsed`).toContain(
                `class="release-body collapsed" id="body-${id}"`
            );
        }
    });

    it('jun-2026 toggle button starts without collapsed class', () => {
        // The toggle for the latest release should NOT have collapsed on the button.
        const togglePattern = /class="release-toggle\s*collapsed"[^>]*data-target="body-jun-2026"/;
        expect(html).not.toMatch(togglePattern);
    });

    it('older release toggle buttons start with collapsed class', () => {
        for (const id of OLDER_RELEASE_IDS) {
            expect(html, `toggle for ${id} should start collapsed`).toContain(
                `class="release-toggle collapsed" data-target="body-${id}"`
            );
        }
    });
});

describe('changelog page — entry data-cats integrity', () => {
    it('every entry element carries a data-cats attribute', () => {
        const totalEntries   = (html.match(/class="entry"/g) || []).length;
        const taggedEntries  = (html.match(/class="entry" data-cats=/g) || []).length;
        expect(totalEntries).toBeGreaterThan(0);
        expect(taggedEntries).toBe(totalEntries);
    });

    it('all data-cats values are valid category tokens', () => {
        const allCatValues = extractDataCatsValues(html);
        expect(allCatValues.length).toBeGreaterThan(0);

        for (const value of allCatValues) {
            const tokens = value.split(' ').filter(Boolean);
            expect(tokens.length, `data-cats="${value}" should have at least one token`).toBeGreaterThan(0);
            for (const token of tokens) {
                expect(VALID_CATS.has(token), `unknown category token "${token}" in data-cats="${value}"`).toBe(true);
            }
        }
    });

    it('each category has at least one entry tagged with it', () => {
        const allCatValues = extractDataCatsValues(html);
        const usedCats = new Set(allCatValues.flatMap((v) => v.split(' ').filter(Boolean)));
        // Every category used in filter chips should appear somewhere
        for (const cat of VALID_CATS) {
            expect(usedCats.has(cat), `category "${cat}" has no tagged entries`).toBe(true);
        }
    });

    it('cat badge class in each entry matches at least one data-cats token', () => {
        // For each <div class="entry" data-cats="...">…<span class="cat cat-FOO">…
        // verify FOO appears in the data-cats tokens.
        const entryPattern = /<div class="entry" data-cats="([^"]+)">([\s\S]*?)<\/div>\s*(?:<\/div>|\s*<div class="entry"|<p class="group-heading"|<\/div>\s*<\/div>)/g;
        let match;
        let checked = 0;
        while ((match = entryPattern.exec(html)) !== null) {
            const cats   = new Set(match[1].split(' ').filter(Boolean));
            const inner  = match[2];
            const badges = [...inner.matchAll(/class="cat cat-([^"]+)"/g)].map((m) => m[1]);
            if (badges.length === 0) continue;
            const primaryBadge = badges[0];
            expect(
                cats.has(primaryBadge),
                `entry data-cats="${match[1]}" but primary badge is cat-${primaryBadge}`
            ).toBe(true);
            checked++;
        }
        expect(checked).toBeGreaterThan(20);
    });
});

describe('changelog page — search and filter UI elements', () => {
    it('has the search input, clear button, and status bar', () => {
        expect(html).toContain('id="cl-search"');
        expect(html).toContain('id="cl-search-clear"');
        expect(html).toContain('id="cl-status"');
    });

    it('has a chip container with all ten category filter buttons', () => {
        expect(html).toContain('id="cl-chips"');
        for (const cat of ['all', ...VALID_CATS]) {
            expect(html, `missing chip for category "${cat}"`).toContain(`data-cat="${cat}"`);
        }
    });

    it('chip container uses horizontal-scroll layout (no wrapping on mobile)', () => {
        expect(html).toContain('overflow-x:auto');
    });

    it('each filter chip has flex-shrink:0 to prevent compression', () => {
        expect(html).toContain('flex-shrink:0');
    });

    it('has a no-results element for empty search/filter states', () => {
        expect(html).toContain('id="cl-no-results"');
    });

    it('has a TOC nav element', () => {
        expect(html).toContain('id="cl-toc"');
    });

    it('has a back-link to the Help Center', () => {
        expect(html).toContain('href="help.html"');
        expect(html).toContain('Help Center');
    });
});

describe('changelog page — JavaScript behaviors', () => {
    it('positions search bar below sticky header via positionSearch()', () => {
        expect(html).toContain('positionSearch');
        expect(html).toContain('searchWrap.style.top');
    });

    it('re-queries header inside update() so async renderHeader injection is reflected', () => {
        // appHeader must be looked up inside update(), not captured once in the outer scope
        // before renderHeader() has run — otherwise it would always be null.
        expect(html).toContain("const appHeader = document.querySelector('header')");
        // The captured-once (buggy) pattern must not be present
        expect(html).not.toMatch(/const appHeader\s*=\s*document\.querySelector[\s\S]{0,20}const searchWrap/);
    });

    it('adjusts sidebar top offset alongside the search bar', () => {
        expect(html).toContain('sidebar.style.top');
    });

    it('contains applyFilters search/filter logic', () => {
        expect(html).toContain('function applyFilters');
        expect(html).toContain('cl-hidden');
        expect(html).toContain('activeCategory');
        expect(html).toContain('searchQuery');
    });

    it('keyboard shortcut handler focuses search on / or Ctrl+K', () => {
        expect(html).toContain("e.key === '/'");
        expect(html).toContain("e.ctrlKey && e.key === 'k'");
        expect(html).toContain('searchInput.focus()');
    });

    it('auto-expands collapsed releases when a search query matches entries inside', () => {
        expect(html).toContain("bodyEl.classList.contains('collapsed')");
        expect(html).toContain("bodyEl.classList.remove('collapsed')");
    });

    it('toggle handler updates button text node to Collapse / Expand', () => {
        expect(html).toContain("textContent = collapsed ? ' Expand' : ' Collapse'");
    });

    it('search clear button hides itself when query is empty', () => {
        expect(html).toContain("searchClear.style.display = q ?");
    });

    it('builds TOC from release sections dynamically', () => {
        expect(html).toContain("document.querySelectorAll('section.release')");
        expect(html).toContain('id="cl-toc"');
    });

    it('uses IntersectionObserver for scroll-spy TOC highlighting', () => {
        expect(html).toContain('IntersectionObserver');
        expect(html).toContain("classList.remove('active')");
        expect(html).toContain("classList.add('active')");
    });
});

describe('changelog page — internal link integrity', () => {
    it('all referenced workflow .html files exist in the repo', () => {
        const workflowLinks = extractWorkflowLinkTargets(html);
        expect(workflowLinks.length).toBeGreaterThan(5);

        for (const file of workflowLinks) {
            expect(
                existsSync(resolve(REPO_ROOT, file)),
                `linked workflow page "${file}" does not exist in repo`
            ).toBe(true);
        }
    });
});

describe('changelog page — content sanity', () => {
    it('has a meaningful number of entries across all releases', () => {
        const entryCount = (html.match(/class="entry"/g) || []).length;
        expect(entryCount).toBeGreaterThan(40);
    });

    it('every release section has at least one entry', () => {
        for (const id of ALL_RELEASE_IDS) {
            // Find the release section and verify it has at least one entry
            const sectionStart = html.indexOf(`id="${id}"`);
            const nextRelease  = ALL_RELEASE_IDS.indexOf(id) + 1;
            const sectionEnd   = nextRelease < ALL_RELEASE_IDS.length
                ? html.indexOf(`id="${ALL_RELEASE_IDS[nextRelease]}"`)
                : html.length;
            const section = html.slice(sectionStart, sectionEnd);
            expect(
                section.includes('class="entry"'),
                `release "${id}" has no entries`
            ).toBe(true);
        }
    });

    it('has correct page title', () => {
        expect(html).toContain('<title>Changelog - ALL PLAYS</title>');
    });
});
