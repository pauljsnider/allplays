import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('team media entry point', () => {
    it('adds Media navigation for full-access, parent, and delegated upload users', () => {
        const teamHtml = readRepoFile('team.html');
        const bannerJs = readRepoFile('js/team-admin-banner.js');

        expect(teamHtml).toContain('if (profile.teamMediaUploadTeamIds) currentUser.teamMediaUploadTeamIds = profile.teamMediaUploadTeamIds;');
        expect(teamHtml).toContain('if (profile.mediaUploadTeamIds) currentUser.mediaUploadTeamIds = profile.mediaUploadTeamIds;');
        expect(bannerJs).toContain('media: `team-media.html#teamId=${teamId}`');
        expect(bannerJs).toContain("label: 'Media', iconName: 'media', active: active === 'media'");
        expect(bannerJs).toContain('// Parent: View, Chat, Media, Help');
        expect(bannerJs).toContain("const canViewMedia = isFullAccess || accessLevel === 'parent' || accessLevel === 'media';");
        expect(bannerJs).toContain('canViewMedia ? actionCard');
    });

    it('loads team media with team-scoped management controls', () => {
        const pageHtml = readRepoFile('team-media.html');
        const pageJs = readRepoFile('js/team-media.js');
        const rules = readRepoFile('firestore.rules');

        expect(pageHtml).toContain('<script type="module" src="js/team-media.js?v=9"></script>');
        expect(pageHtml).toContain('id="team-media-upload-panel"');
        expect(pageHtml).toContain('id="team-media-admin-panel"');
        expect(pageHtml).toContain('id="bulk-actions"');
        expect(pageHtml).toContain('id="album-detail"');
        expect(pageHtml).toContain('id="folder-visibility"');
        expect(pageHtml).toContain('Add album');
        expect(pageHtml).toContain('Upload files');
        expect(pageHtml).toContain('image files up to 10 MB each');
        expect(pageHtml).toContain('CSVs up to 10 MB each');
        expect(pageHtml).toContain('Save video link');
        expect(pageJs).toMatch(/import \{ checkAuth \} from '\.\/auth\.js\?v=\d+';/);
        expect(pageJs).toContain("from './db.js?v=81'");
        expect(pageJs).toContain('team.html#teamId=${encodeURIComponent(state.teamId)}');
        expect(pageJs).toContain('state.canManage = canManageTeamMedia(user, state.team);');
        expect(pageJs).toContain('uploadTeamMediaPhoto');
        expect(pageJs).toContain('uploadTeamMediaFile');
        expect(pageJs).toContain('Create an album first');
        expect(pageJs).toContain('getMediaPermissionMessage');
        expect(pageJs).toContain('updateTeamMediaFolder');
        expect(pageJs).toContain('deleteTeamMediaFolder');
        expect(pageJs).toContain('canReadTeamMediaAlbum');
        expect(pageJs).toContain('bulkDeleteTeamMediaItems');
        expect(pageJs).toContain('setTeamMediaAlbumCover');
        expect(pageJs).toContain('getTeamMediaItemsPage');
        expect(pageJs).toContain('TEAM_MEDIA_PAGE_SIZE');
        expect(pageJs).toContain('data-load-more-media');
        expect(pageJs).not.toContain('getTeamMediaItems(state.teamId)');
        expect(pageJs).toContain('MEDIA_TYPE_FILTERS');
        expect(pageJs).toContain("{ id: 'videos', label: 'Videos' }");
        expect(pageJs).toContain('data-media-type-filter');
        expect(pageJs).toContain('aria-label="Media type filters"');
        expect(pageJs).toContain('getMediaTypeCounts');
        expect(pageJs).toContain('matchesMediaTypeFilter(item, state.selectedMediaType)');
        expect(pageJs).toContain('No ${escapeHtml(emptyStateLabel)} in this album.');
        expect(pageJs).toContain('download class="rounded-lg');
        expect(pageJs).toContain('data-set-cover');
        expect(rules).toContain('match /mediaFolders/{folderId}');
        expect(rules).toContain('allow read: if canReadTeamMediaFolder(teamId, resource.data);');
        expect(rules).toContain('allow read: if canReadTeamMediaItem(teamId, resource.data);');
        expect(rules).toContain('allow create: if isTeamOwnerOrAdmin(teamId) || isTeamMediaUploadCreate(teamId, request.resource.data);');
        expect(rules).toContain('allow update: if isTeamOwnerOrAdmin(teamId) || isOwnTeamMediaUploadSoftDelete(teamId) || isTeamMediaTitleUpdate(teamId);');
    });
});
