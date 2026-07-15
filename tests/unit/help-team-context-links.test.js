// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { preserveHelpBackLinkContext } from '../../js/help-context.js';

function readRepoFile(relativePath) {
    return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function bootHelpPage(search = '') {
    const html = readRepoFile('help.html');
    const dom = new JSDOM(html, {
        url: `https://allplays.test/help.html${search}`,
        runScripts: 'outside-only'
    });

    const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const helpPageScript = inlineScripts.at(-1)?.[1];
    if (!helpPageScript) {
        throw new Error('Help page script not found');
    }

    dom.window.eval(helpPageScript);
    return dom.window.document;
}

function readWorkflowLinks(document) {
    return Array.from(document.querySelectorAll('#help-grid article a')).map((link) => new URL(link.href));
}

function readPageReferenceLink(document) {
    return new URL(document.getElementById('help-page-reference-link').href);
}

function bootStaticPage(relativePath, search = '') {
    const html = readRepoFile(relativePath);
    const dom = new JSDOM(html, {
        url: `https://allplays.test/${relativePath}${search}`,
        runScripts: 'outside-only'
    });

    return {
        html,
        document: dom.window.document,
        window: dom.window
    };
}

describe('help team-context deep links', () => {
    it('hydrates parent role and preserves team context on rendered workflow links', () => {
        const document = bootHelpPage('?context=team&teamId=TEAM123&role=parent');

        expect(document.getElementById('help-role').value).toBe('Parent');

        const links = readWorkflowLinks(document);
        expect(links.length).toBeGreaterThan(0);
        links.forEach((link) => {
            expect(link.searchParams.get('context')).toBe('team');
            expect(link.searchParams.get('teamId')).toBe('TEAM123');
            expect(link.searchParams.get('role')).toBe('parent');
        });
    });

    it('hydrates scorekeeper role and renders only scorekeeper workflows', () => {
        const document = bootHelpPage('?context=team&teamId=TEAM123&role=scorekeeper');

        expect(document.getElementById('help-role').value).toBe('Scorekeeper');
        expect(document.getElementById('help-summary').textContent).toBe('3 of 19 workflows');
        expect(readWorkflowLinks(document).map((link) => path.basename(link.pathname))).toEqual([
            'help-team-operations.html',
            'workflow-track-game.html',
            'workflow-live-tracker.html'
        ]);
    });

    it('preserves team context on the page-reference link', () => {
        const document = bootHelpPage('?context=team&teamId=TEAM123&role=coach');

        const link = readPageReferenceLink(document);
        expect(link.pathname).toBe('/help-page-reference.html');
        expect(link.searchParams.get('context')).toBe('team');
        expect(link.searchParams.get('teamId')).toBe('TEAM123');
        expect(link.searchParams.get('role')).toBe('coach');
    });

    it('restores workflow cards with original team context after clearing a zero-match search', () => {
        const document = bootHelpPage('?context=team&teamId=TEAM123&role=parent');
        const searchInput = document.getElementById('help-search');
        const roleSelect = document.getElementById('help-role');
        const emptyState = document.getElementById('help-empty');
        const grid = document.getElementById('help-grid');
        const view = document.defaultView;

        roleSelect.value = 'Parent';
        searchInput.value = 'zzzz-no-match';
        searchInput.dispatchEvent(new view.Event('input', { bubbles: true }));

        expect(emptyState.classList.contains('hidden')).toBe(false);
        expect(grid.classList.contains('hidden')).toBe(true);

        searchInput.value = '';
        roleSelect.value = '';
        searchInput.dispatchEvent(new view.Event('input', { bubbles: true }));
        roleSelect.dispatchEvent(new view.Event('change', { bubbles: true }));

        expect(emptyState.classList.contains('hidden')).toBe(true);
        expect(grid.classList.contains('hidden')).toBe(false);

        const [firstLink] = readWorkflowLinks(document);
        expect(firstLink.searchParams.get('context')).toBe('team');
        expect(firstLink.searchParams.get('teamId')).toBe('TEAM123');
        expect(firstLink.searchParams.get('role')).toBe('parent');
    });

    it('preserves team context on workflow back links', () => {
        const { document } = bootStaticPage('workflow-schedule.html', '?context=team&teamId=TEAM123&role=coach');

        preserveHelpBackLinkContext(document, '?context=team&teamId=TEAM123&role=coach');

        const link = new URL(document.querySelector('[data-help-back-link]').href);
        expect(link.pathname).toBe('/help.html');
        expect(link.searchParams.get('context')).toBe('team');
        expect(link.searchParams.get('teamId')).toBe('TEAM123');
        expect(link.searchParams.get('role')).toBe('coach');
    });

    it('preserves team context on the page-reference back link', () => {
        const { document } = bootStaticPage('help-page-reference.html', '?context=team&teamId=TEAM123&role=coach');

        preserveHelpBackLinkContext(document, '?context=team&teamId=TEAM123&role=coach');

        const link = new URL(document.querySelector('[data-help-back-link]').href);
        expect(link.pathname).toBe('/help.html');
        expect(link.searchParams.get('context')).toBe('team');
        expect(link.searchParams.get('teamId')).toBe('TEAM123');
        expect(link.searchParams.get('role')).toBe('coach');
    });

    it('wires help context preservation into every workflow back link', () => {
        const repoRoot = process.cwd();
        const htmlPages = readdirSync(repoRoot)
            .filter((file) => /^workflow-.*\.html$/.test(file) || file === 'help-team-operations.html' || file === 'help-page-reference.html')
            .sort();

        expect(htmlPages.length).toBeGreaterThan(0);
        htmlPages.forEach((file) => {
            const html = readRepoFile(file);
            expect(html).toContain('data-help-back-link');
            expect(html).toContain('./js/help-context.js?v=1');
        });
    });
});
