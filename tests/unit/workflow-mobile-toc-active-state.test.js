import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function expectMobileTocActiveStateSupport(source) {
    expect(source).toContain(".filter((h) => h.id !== 'in-this-article');");
    expect(source).toContain('const allLinks = [...links];');
    expect(source).toContain('const ensureMobileToc = () => {');
    expect(source).toContain('if (!mobileToc || mobileWrapper || window.innerWidth >= 1024) return;');
    expect(source).toContain("const mobileLinks = Array.from(list.querySelectorAll('a'));");
    expect(source).toContain('allLinks.push(...mobileLinks);');
    expect(source).toContain('addLinkHandlers(mobileLinks);');
    expect(source).toContain("allLinks.forEach((a) => a.classList.toggle('is-active'");
    expect(source).toContain('const addLinkHandlers = (tocLinks) => {');
    expect(source).toContain("window.addEventListener('hashchange', () => setActive(window.location.hash.slice(1)));");
    expect(source).toContain('const syncHashActiveAfterResize = () => {');
    expect(source).toContain("if (!window.location.hash) return;");
    expect(source).toContain("window.requestAnimationFrame(() => {");
    expect(source).toContain("window.requestAnimationFrame(() => setActive(null));");
    expect(source).toContain("window.addEventListener('resize', () => {");
    expect(source).toContain('syncHashActiveAfterResize();');
    expect(source).not.toContain("links.forEach((a) => a.classList.toggle('is-active'");
}

describe('workflow mobile TOC active state', () => {
    it('keeps generated workflow pages updating cloned mobile TOC links', () => {
        expectMobileTocActiveStateSupport(readRepoFile('workflow-postgame.html'));
    });

    it('keeps the workflow HTML generator aligned with the runtime fix', () => {
        expectMobileTocActiveStateSupport(readRepoFile('scripts/build-help-workflow-html-loop.mjs'));
    });
});
