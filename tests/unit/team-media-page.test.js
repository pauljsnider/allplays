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
    });

    it('loads team media with team-scoped access checks and read-only empty states', () => {
        const pageHtml = readRepoFile('team-media.html');
        const pageJs = readRepoFile('js/team-media.js');
        const rules = readRepoFile('firestore.rules');

        expect(pageHtml).toContain('<script type="module" src="./js/team-media.js?v=1"></script>');
        expect(pageJs).toContain("collection(db, 'teams', teamId, 'mediaFolders')");
        expect(pageJs).toContain("active: 'media'");
        expect(pageJs).toContain("!['full', 'parent'].includes(accessInfo.accessLevel)");
        expect(pageJs).toContain('Folder and video management will be added in a later workflow.');
        expect(pageJs).toContain('This page is read-only for parents and team followers.');
        expect(rules).toContain('match /mediaFolders/{folderId}');
        expect(rules).toContain('allow read: if canAccessTeamChat(teamId);');
        expect(rules).toContain('allow create, update, delete: if false;');
    });
});
