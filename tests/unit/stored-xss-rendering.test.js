import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const liveGameSource = readFileSync(new URL('../../js/live-game.js', import.meta.url), 'utf8');
const liveTrackerSource = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
const trackLiveSource = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');
const appLiveGameChatSource = readFileSync(new URL('../../apps/app/src/lib/liveGameChatService.ts', import.meta.url), 'utf8');
const drillsSource = readFileSync(new URL('../../drills.html', import.meta.url), 'utf8');

describe('stored image URL XSS rendering contracts', () => {
    it('constructs live-game avatars with the trusted DOM image helper', () => {
        expect(liveGameSource).toContain('createSafeImageElement({');
        expect(liveGameSource).toContain('resolveUrl: resolveSafeProfilePhotoUrl');
        expect(liveGameSource).toContain('row.appendChild(avatar || fallback);');
        expect(liveGameSource).not.toContain('<img src="${msg.senderPhotoUrl}"');
        expect(liveGameSource).toContain('senderPhotoUrl: resolveSafeProfilePhotoWriteUrl(state.user?.photoURL) || null');
        expect(liveGameSource).not.toContain('senderPhotoUrl: state.user?.photoURL || null');
    });

    it('normalizes React app chat avatars before constructing the write payload', () => {
        expect(appLiveGameChatSource).toContain('senderPhotoUrl: resolveSafeProfilePhotoWriteUrl(user?.photoUrl) || null');
        expect(appLiveGameChatSource).not.toContain('senderPhotoUrl: compactString(user?.photoUrl) || null');
    });

    it('normalizes scorer tracker chat avatars before constructing the write payload', () => {
        expect(liveTrackerSource).toContain("import { resolveSafeProfilePhotoWriteUrl } from './safe-image-url.js?v=1';");
        expect(liveTrackerSource).toContain('senderPhotoUrl: resolveSafeProfilePhotoWriteUrl(currentUser?.photoURL) || null');
        expect(liveTrackerSource).not.toContain('senderPhotoUrl: currentUser?.photoURL || null');
        expect(trackLiveSource).toContain("import { resolveSafeProfilePhotoWriteUrl } from './js/safe-image-url.js?v=1';");
        expect(trackLiveSource).toContain('senderPhotoUrl: resolveSafeProfilePhotoWriteUrl(currentUser?.photoURL) || null');
        expect(trackLiveSource).not.toContain('senderPhotoUrl: currentUser?.photoURL || null');
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
