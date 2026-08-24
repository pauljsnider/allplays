import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Performance regression guard: user-content images (team/player photos, media
// grids, drill diagrams, chat media, friend avatars) must defer offscreen
// decoding so the image-heavy mobile views stay responsive. Since iOS/Android
// share the same WebView bundle, these attributes benefit all three platforms.

function read(relativePath) {
    return readFileSync(new URL(`../../apps/app/${relativePath}`, import.meta.url), 'utf8');
}

function readRepo(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function imageTagsContaining(source, marker) {
    return (source.match(/<img\b[^>]*>/g) || []).filter((tag) => tag.includes(marker));
}

function expectEagerAsyncImages(source, marker, expectedCount = 1) {
    const tags = imageTagsContaining(source, marker);
    expect(tags).toHaveLength(expectedCount);
    tags.forEach((tag) => {
        expect(tag).toContain('decoding="async"');
        expect(tag).not.toContain('loading="lazy"');
    });
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

    it('keeps primary initial-view images eager while decoding asynchronously', () => {
        expectEagerAsyncImages(readRepo('athlete-profile.html'), 'profile.profilePhotoUrl');
        expectEagerAsyncImages(readRepo('game.html'), 'resolvedTeam.photoUrl');
        expectEagerAsyncImages(readRepo('game.html'), 'game.opponentTeamPhoto', 2);
        expectEagerAsyncImages(readRepo('live-game.html'), 'home-team-photo');
        expectEagerAsyncImages(readRepo('live-game.html'), 'away-team-photo');
        expectEagerAsyncImages(readRepo('login.html'), 'google.svg');
        expectEagerAsyncImages(readRepo('player.html'), 'player.photoUrl');
        expectEagerAsyncImages(readRepo('team-chat.html'), 'escapeHtml(photoUrl)');
        expectEagerAsyncImages(readRepo('team.html'), 'escapeHtml(team.photoUrl)');
        expectEagerAsyncImages(read('src/pages/PrivateAiChat.tsx'), './logo_small.png', 2);
        expectEagerAsyncImages(read('src/pages/PublicTeamDetail.tsx'), 'team.photoUrl');
    });

    it('eager-loads only the first card image in legacy team lists', () => {
        const dashboardSource = readRepo('dashboard.html');
        const teamsSource = readRepo('teams.html');

        expect(imageTagsContaining(dashboardSource, 'escapeHtml(team.photoUrl)')).toEqual([
            expect.stringContaining('loading="${eager ? \'eager\' : \'lazy\'}" decoding="async"')
        ]);
        expect(dashboardSource).toContain('function renderTeamCard(team, { eager = false } = {})');
        expect(dashboardSource).toContain('parentOnlyTeams.map((team, index) => renderTeamCard(team, { eager: index === 0 }))');
        expect(dashboardSource).toContain('fullAccessTeams.map((team, index) => renderTeamCard(team, { eager: index === 0 }))');
        expect(dashboardSource).toContain('parentOnlyTeams.map(team => renderTeamCard(team))');

        expect(imageTagsContaining(teamsSource, 'safePhotoUrl')).toEqual([
            expect.stringContaining('loading="${eager ? \'eager\' : \'lazy\'}" decoding="async"')
        ]);
        expect(teamsSource).toContain('const card = (team, { eager = false } = {}) => {');
        expect(teamsSource).toContain('const eager = renderedCardIndex === 0;');
        expect(teamsSource).toContain('return card(team, { eager });');
    });

    it('keeps the below-the-fold About founder portrait lazy', () => {
        const [founderPortrait] = imageTagsContaining(readRepo('about.html'), 'Paul Snider — founder');
        expect(founderPortrait).toContain('loading="lazy"');
        expect(founderPortrait).toContain('decoding="async"');
    });
});
