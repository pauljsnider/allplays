import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function readRepoFile(relativePath) {
    return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

function extractReferenceFiles(html) {
    return [...html.matchAll(/<td class="px-4 py-3 font-mono">([^<]+\.html)<\/td>/g)].map((match) => match[1]);
}

describe('help page reference integrity', () => {
    it('keeps the file-by-file page reference discoverable from help center', () => {
        const helpHtml = readRepoFile('help.html');
        expect(helpHtml).toContain('href="help-page-reference.html"');
        expect(helpHtml).toContain('View file-by-file page reference');
    });

    it('lists only shipped html files in help-page-reference.html', () => {
        const referenceHtml = readRepoFile('help-page-reference.html');
        const referencedFiles = extractReferenceFiles(referenceHtml);

        expect(referencedFiles).toContain('edit-schedule.html');
        expect(referencedFiles).toContain('live-game.html');
        expect(referencedFiles).toContain('help-page-reference.html');

        referencedFiles.forEach((file) => {
            expect(existsSync(resolve(REPO_ROOT, file)), `${file} should exist in the repo`).toBe(true);
        });
    });
});
