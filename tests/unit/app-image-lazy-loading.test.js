import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Performance regression guard: user-content images (team/player photos, media
// grids, drill diagrams, chat media, friend avatars) must defer offscreen
// decoding so the image-heavy mobile views stay responsive. Since iOS/Android
// share the same WebView bundle, these attributes benefit all three platforms.

function read(relativePath) {
    return readFileSync(new URL(`../../apps/app/${relativePath}`, import.meta.url), 'utf8');
}

describe('app image lazy loading', () => {
    it('lazy-loads repeated roster photos in game report sections', () => {
        const source = read('src/components/schedule/GameReportSectionContent.tsx');
        expect(source).toContain('src={player.photoUrl} alt="" loading="lazy" decoding="async"');
    });

    it('lazy-loads team media grid images', () => {
        const source = read('src/pages/TeamMedia.tsx');
        expect(source).toContain('src={featured.url} alt="" loading="lazy" decoding="async"');
        expect(source).toContain('src={coverUrl} alt="" loading="lazy" decoding="async"');
    });

    it('lazy-loads drill diagram images', () => {
        const source = read('src/pages/TeamDrills.tsx');
        expect(source).toContain('src={url} alt={`${drill.title} diagram ${index + 1}`} loading="lazy" decoding="async"');
    });

    it('lazy-loads friend avatars on the home feed', () => {
        const source = read('src/pages/Home.tsx');
        expect(source).toContain('src={friend.photoUrl} alt="" loading="lazy" decoding="async"');
    });

    it('lazy-loads chat sender avatars and inline media', () => {
        const source = read('src/pages/messages/components/ChatWindow.tsx');
        expect(source).toContain('src={message.senderPhotoUrl} alt={`${label} profile photo`} loading="lazy" decoding="async"');
        expect(source).toContain('src={entry.url} alt={entry.name || \'Chat media\'} loading="lazy" decoding="async"');
    });

    it('async-decodes the team detail hero photo without blocking LCP via lazy', () => {
        const source = read('src/pages/TeamDetail.tsx');
        expect(source).toContain('alt={`${team.name} team photo`} decoding="async"');
        // Hero banner stays eager so it is not deferred as the LCP element.
        expect(source).not.toContain('alt={`${team.name} team photo`} loading="lazy"');
    });

    it('keeps immediately visible app chrome logos eager while decoding asynchronously', () => {
        const appSource = read('src/App.tsx');
        const appShellSource = read('src/components/AppShell.tsx');
        const authFrameSource = read('src/components/AuthFrame.tsx');

        expect(appSource).toContain('src="./logo_small.png" alt="" decoding="async" className="mx-auto h-12 w-12 rounded-xl"');
        expect(appSource).not.toContain('src="./logo_small.png" alt="" loading="lazy"');

        expect(appShellSource.match(/src="\.\/logo_small\.png" alt="" decoding="async"/g)).toHaveLength(2);
        expect(appShellSource).not.toContain('src="./logo_small.png" alt="" loading="lazy"');

        expect(authFrameSource).toContain('src="./logo_small.png" alt="" decoding="async" className="h-11 w-11 rounded-xl shadow-sm"');
        expect(authFrameSource).not.toContain('src="./logo_small.png" alt="" loading="lazy"');
    });
});
