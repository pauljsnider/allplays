import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const liveGameSource = readFileSync(new URL('../../js/live-game.js', import.meta.url), 'utf8');
const drillsSource = readFileSync(new URL('../../drills.html', import.meta.url), 'utf8');

describe('stored image URL XSS rendering contracts', () => {
    it('constructs live-game avatars with the trusted DOM image helper', () => {
        expect(liveGameSource).toContain('createSafeImageElement({');
        expect(liveGameSource).toContain('resolveUrl: resolveSafeProfilePhotoUrl');
        expect(liveGameSource).toContain('row.appendChild(avatar || fallback);');
        expect(liveGameSource).not.toContain('<img src="${msg.senderPhotoUrl}"');
        expect(liveGameSource).not.toContain('senderPhotoUrl: state.user?.photoURL || null');
    });

    it('keeps persisted diagram URLs out of HTML and inline handlers', () => {
        expect(drillsSource).toContain('state.currentDetailDiagramUrls[index]');
        expect(drillsSource).toContain("image.dataset.diagramIndex = String(diagramIndex);");
        expect(drillsSource).toContain("detailContent.addEventListener('click', activateDiagram);");
        expect(drillsSource).toContain('resolveUrl: resolveSafeDrillDiagramUrl');
        expect(drillsSource).not.toContain('onclick="openDiagramLightbox(\'');
        expect(drillsSource).not.toContain('overlay.innerHTML = `<img');
        expect(drillsSource).not.toContain('src="${escapeHtml(url)}"');
    });
});
