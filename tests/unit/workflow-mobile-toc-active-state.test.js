import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function expectMobileTocActiveStateSupport(source) {
    expect(source).toContain('const allLinks = [...links];');
    expect(source).toContain("allLinks.push(...Array.from(list.querySelectorAll('a')));");
    expect(source).toContain("allLinks.forEach((a) => a.classList.toggle('is-active'");
    expect(source).toContain("a.addEventListener('click', () => {");
    expect(source).toContain("window.addEventListener('hashchange', () => setActive(window.location.hash.slice(1)));");
    expect(source).not.toContain("links.forEach((a) => a.classList.toggle('is-active'");
}

describe('workflow mobile TOC active state', () => {
    it('keeps generated workflow pages updating cloned mobile TOC links', () => {
        expectMobileTocActiveStateSupport(readRepoFile('workflow-game-day.html'));
    });

    it('keeps the workflow HTML generator aligned with the runtime fix', () => {
        expectMobileTocActiveStateSupport(readRepoFile('scripts/build-help-workflow-html-loop.mjs'));
    });
});
