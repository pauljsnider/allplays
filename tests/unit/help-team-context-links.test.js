// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

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
});
