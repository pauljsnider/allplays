import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('team chat media gallery actions wiring', () => {
    it('renders first-class media action controls in the gallery', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('Share');
        expect(html).toContain('Save');
        expect(html).toContain('Copy link');
        expect(html).toContain('data-media-action="share"');
        expect(html).toContain('data-media-action="download"');
        expect(html).toContain('data-media-action="copy-link"');
    });

    it('wires gallery action handlers for share, save, and copy link fallbacks', () => {
        const html = readRepoFile('team-chat.html');

        expect(html).toContain('handleGalleryMediaAction');
        expect(html).toContain('handleMediaShare');
        expect(html).toContain('handleMediaDownload');
        expect(html).toContain('handleMediaCopyLink');
        expect(html).toContain("navigator.share");
        expect(html).toContain("navigator.clipboard?.writeText");
    });
});
