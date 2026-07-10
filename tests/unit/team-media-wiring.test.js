import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

function canReadTeamMediaObject({ authUid, isTeamAdmin = false, isTeamParent = false, folderExists = true, folderVisibility = 'team' }) {
    if (!authUid) return false;
    if (isTeamAdmin) return true;
    return isTeamParent && folderExists && folderVisibility === 'team';
}

function canDeleteTeamMediaObject({ authUid, pathUserId, isTeamAdmin = false, isTeamParent = false, hasUploadGrant = false, folderExists = true, folderVisibility = 'team' }) {
    return authUid !== null &&
        (isTeamAdmin ||
            (authUid === pathUserId &&
                (canReadTeamMediaObject({ authUid, isTeamParent, folderExists, folderVisibility }) ||
                    (hasUploadGrant && folderExists && folderVisibility === 'team'))));
}

describe('team media page wiring', () => {
    it('links the dashboard to the team media library', () => {
        const dashboard = fs.readFileSync(path.join(repoRoot, 'dashboard.html'), 'utf8');
        expect(dashboard).toContain('team-media.html#teamId=${team.id}');
    });

    it('loads the team media module and cache-busted db dependency', () => {
        const page = fs.readFileSync(path.join(repoRoot, 'team-media.html'), 'utf8');
        const source = fs.readFileSync(path.join(repoRoot, 'js/team-media.js'), 'utf8');

        expect(page).toContain('src="js/team-media.js?v=12"');
        expect(page).toContain('Add album');
        expect(page).toContain('Upload files');
        expect(page).toContain('Save video link');
        expect(source).toContain("from './db.js?v=91'");
        expect(source).toContain('normalizeTeamMediaVideoDraft');
        expect(source).toContain("import { checkAuth } from './auth.js?v=46';");
        expect(source).toContain('checkAuth(async (user) => {');
        expect(source).toContain('team.html#teamId=${encodeURIComponent(state.teamId)}');
        expect(source).toContain('Team media permissions are not enabled');
        expect(source).toContain('updateTeamMediaFolder');
        expect(source).toContain('deleteTeamMediaFolder');
        expect(source).toContain('actionInFlight: false');
        expect(source).toContain('if (state.actionInFlight) return;');
        expect(source).toContain('state.actionInFlight = false;');
        expect(source).toContain('getTeamMediaItemsPage');
        expect(source).toContain('data-load-more-media');
    });

    it('keeps jsdom team media db mocks aligned with the runtime db import', () => {
        const source = fs.readFileSync(path.join(repoRoot, 'js/team-media.js'), 'utf8');
        const dbImportVersion = source.match(/from '\.\/db\.js\?v=(\d+)'/)?.[1];

        expect(dbImportVersion).toBe('91');

        for (const testFile of [
            'tests/unit/team-media-item-rename.test.js',
            'tests/unit/team-media-legacy-upload-forms.test.js'
        ]) {
            const testSource = fs.readFileSync(path.join(repoRoot, testFile), 'utf8');
            expect(testSource).toContain(`vi.mock('../../js/db.js?v=${dbImportVersion}'`);
            expect(testSource).not.toContain("vi.mock('../../js/db.js?v=83'");
        }
    });

    it('keeps media reads member-scoped and uploads explicitly approved', () => {
        const rules = fs.readFileSync(path.join(repoRoot, 'firestore.rules'), 'utf8');
        expect(rules).toContain('match /mediaFolders/{folderId}');
        expect(rules).toContain('allow read: if canReadTeamMediaFolder(teamId, resource.data);');
        expect(rules).toContain('allow create, delete: if isTeamOwnerOrAdmin(teamId);');
        expect(rules).toContain('allow update: if isTeamOwnerOrAdmin(teamId) || isTeamMediaUploadCounterUpdate(teamId);');
        expect(rules).toContain('allow read: if canReadTeamMediaItem(teamId, resource.data);');
        expect(rules).toContain('allow create: if isTeamOwnerOrAdmin(teamId) || isTeamMediaUploadCreate(teamId, request.resource.data);');
        expect(rules).toContain('allow update: if isTeamOwnerOrAdmin(teamId) || isOwnTeamMediaUploadSoftDelete(teamId) || isTeamMediaTitleUpdate(teamId);');
        expect(rules).toContain("folderData.get('visibility', 'team') == 'team'");
        expect(rules).toContain("get(folderPath).data.get('visibility', 'team') == 'team'");
        expect(rules).toContain("teamId in get(userPath).data.get('teamMediaUploadTeamIds', [])");
        expect(rules).toContain('function isTeamMediaUploadCounterUpdate(teamId) {');
        expect(rules).toContain("request.resource.data.get('nextMediaOrder', 0) == resource.data.get('nextMediaOrder', 0) + 1");
        expect(rules).toContain('canUploadTeamMediaFolder(teamId, data.folderId)');
    });

    it('configures team-scoped storage rules for album photos', () => {
        const firebaseJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'firebase.json'), 'utf8'));
        const storageRules = fs.readFileSync(path.join(repoRoot, 'storage.rules'), 'utf8');

        expect(firebaseJson.storage.rules).toBe('storage.rules');
        expect(storageRules).toContain('match /team-media/{teamId}/{folderId}/{userId}/{fileName}');
        expect(storageRules).toContain('function canReadTeamMediaObject(teamId, folderId)');
        expect(storageRules).toContain('allow get: if canReadTeamMediaObject(teamId, folderId);');
        expect(storageRules).toContain("firestore.get(folderPath).data.get('visibility', 'team') == 'team'");
        expect(storageRules).toContain('canCreateTeamMediaUpload(teamId, folderId)');
        expect(storageRules).toContain('(isTeamOwnerOrAdmin(teamId) || request.auth.uid == userId)');
        expect(storageRules).toContain("teamId in firestore.get(userPath).data.get('teamMediaUploadTeamIds', [])");
        expect(storageRules).toContain('canUploadTeamMediaFolder(teamId, folderId)');
        expect(storageRules).toContain('isAllowedTeamMediaUploadType(request.resource.contentType)');
        expect(storageRules).toContain('application/pdf');
        expect(storageRules).toContain('function canDeleteOwnTeamMediaObject(teamId, folderId, userId)');
        expect(storageRules).toContain('(hasTeamMediaUploadGrant(teamId) && canUploadTeamMediaFolder(teamId, folderId))');
        expect(storageRules).toContain('allow delete: if isTeamOwnerOrAdmin(teamId) ||\n        canDeleteOwnTeamMediaObject(teamId, folderId, userId);');
        expect(storageRules).not.toContain('allow delete: if isTeamOwnerOrAdmin(teamId) || request.auth.uid == userId;');
    });

    it('denies revoked or private-folder uploader deletes while preserving current uploader and admin cleanup', () => {
        expect(canReadTeamMediaObject({ authUid: 'parent-1', isTeamParent: true, folderVisibility: 'team' })).toBe(true);
        expect(canReadTeamMediaObject({ authUid: 'parent-1', isTeamParent: true, folderVisibility: 'private' })).toBe(false);
        expect(canReadTeamMediaObject({ authUid: 'parent-1', isTeamParent: true, folderExists: false })).toBe(false);
        expect(canReadTeamMediaObject({ authUid: 'admin-1', isTeamAdmin: true, folderVisibility: 'private' })).toBe(true);
        expect(canDeleteTeamMediaObject({ authUid: 'parent-1', pathUserId: 'parent-1', isTeamParent: true })).toBe(true);
        expect(canDeleteTeamMediaObject({ authUid: 'parent-1', pathUserId: 'parent-1', isTeamParent: false })).toBe(false);
        expect(canDeleteTeamMediaObject({ authUid: 'contributor-1', pathUserId: 'contributor-1', hasUploadGrant: true })).toBe(true);
        expect(canDeleteTeamMediaObject({ authUid: 'contributor-1', pathUserId: 'contributor-1', hasUploadGrant: false })).toBe(false);
        expect(canDeleteTeamMediaObject({ authUid: 'parent-1', pathUserId: 'parent-1', isTeamParent: true, folderVisibility: 'private' })).toBe(false);
        expect(canDeleteTeamMediaObject({ authUid: 'contributor-1', pathUserId: 'contributor-1', hasUploadGrant: true, folderVisibility: 'private' })).toBe(false);
        expect(canDeleteTeamMediaObject({ authUid: 'admin-1', pathUserId: 'parent-1', isTeamAdmin: true, folderVisibility: 'private' })).toBe(true);
    });

    it('models moved media as inaccessible to parents once the old team-visible object is gone', () => {
        const parentCanReadOldVisiblePath = canReadTeamMediaObject({ authUid: 'parent-1', isTeamParent: true, folderVisibility: 'team' });
        const parentCanReadMovedPrivatePath = canReadTeamMediaObject({ authUid: 'parent-1', isTeamParent: true, folderVisibility: 'private' });
        const parentCanReadDeletedOldPath = canReadTeamMediaObject({ authUid: 'parent-1', isTeamParent: true, folderExists: false, folderVisibility: 'team' });

        expect(parentCanReadOldVisiblePath).toBe(true);
        expect(parentCanReadMovedPrivatePath).toBe(false);
        expect(parentCanReadDeletedOldPath).toBe(false);
    });
});
