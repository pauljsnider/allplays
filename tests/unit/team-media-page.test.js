import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('team media entry point', () => {
    it('adds Media navigation for full-access and parent team users', () => {
        const bannerJs = readRepoFile('js/team-admin-banner.js');

        expect(bannerJs).toContain('media: `team-media.html#teamId=${teamId}`');
        expect(bannerJs).toContain("label: 'Media', iconName: 'media', active: active === 'media'");
        expect(bannerJs).toContain('// Parent: View, Chat, Media, Help');
        expect(bannerJs).toContain("const canViewMedia = isFullAccess || accessLevel === 'parent';");
        expect(bannerJs).toContain('canViewMedia ? actionCard');
    });

    it('loads team media with team-scoped management controls', () => {
        const pageHtml = readRepoFile('team-media.html');
        const pageJs = readRepoFile('js/team-media.js');
        const rules = readRepoFile('firestore.rules');

        expect(pageHtml).toContain('<script type="module" src="js/team-media.js?v=2"></script>');
        expect(pageHtml).toContain('id="team-media-upload-panel"');
        expect(pageHtml).toContain('id="team-media-admin-panel"');
        expect(pageHtml).toContain('id="bulk-actions"');
        expect(pageJs).toContain("import { checkAuth } from './auth.js?v=13';");
        expect(pageJs).toContain("from './db.js?v=13'");
        expect(pageJs).toContain('team.html#teamId=${encodeURIComponent(state.teamId)}');
        expect(pageJs).toContain('state.canManage = canManageTeamMedia(user, state.team);');
        expect(pageJs).toContain('uploadTeamMediaPhoto');
        expect(pageJs).toContain('bulkDeleteTeamMediaItems');
        expect(pageJs).toContain('setTeamMediaAlbumCover');
        expect(pageJs).toContain('download class="rounded-lg');
        expect(pageJs).toContain('data-set-cover');
        expect(rules).toContain('match /mediaFolders/{folderId}');
        expect(rules).toContain('allow read: if canAccessTeamChat(teamId);');
        expect(rules).toContain('allow create: if isTeamOwnerOrAdmin(teamId) || isTeamMediaPhotoCreate(teamId, request.resource.data);');
        expect(rules).toContain('allow update: if isTeamOwnerOrAdmin(teamId) || isOwnTeamMediaPhotoSoftDelete(teamId);');
    });
});
