import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('team media Firestore rules', () => {
    it('defines team media folders and items under teams', () => {
        expect(rules).toContain('match /mediaFolders/{folderId}');
        expect(rules).toContain('match /mediaItems/{itemId}');
    });

    it('limits reads to visible albums while preserving approved member uploads', () => {
        const mediaRulesStart = rules.indexOf('match /mediaFolders/{folderId}');
        const mediaRulesEnd = rules.indexOf('// Chat messages subcollection', mediaRulesStart);
        const mediaRules = rules.slice(mediaRulesStart, mediaRulesEnd);

        expect(mediaRules).toContain('allow read: if canReadTeamMediaFolder(teamId, resource.data);');
        expect(mediaRules).toContain('allow create, delete: if isTeamOwnerOrAdmin(teamId);');
        expect(mediaRules).toContain('allow update: if isTeamOwnerOrAdmin(teamId) || isTeamMediaUploadCounterUpdate(teamId);');
        expect(mediaRules).toContain('allow read: if canReadTeamMediaItem(teamId, resource.data);');
        expect(mediaRules).toContain('allow create: if isTeamOwnerOrAdmin(teamId) || isTeamMediaUploadCreate(teamId, request.resource.data);');
        expect(mediaRules).toContain('allow update: if isTeamOwnerOrAdmin(teamId) || isOwnTeamMediaUploadSoftDelete(teamId) || isTeamMediaTitleUpdate(teamId);');
        expect(rules).toContain("teamId in get(userPath).data.get('teamMediaUploadTeamIds', [])");
        expect(rules).toContain("teamId in get(userPath).data.get('mediaUploadTeamIds', [])");
        expect(rules).toContain('function isTeamMediaUploadCounterUpdate(teamId) {');
        expect(rules).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['nextMediaOrder', 'updatedAt'])");
        expect(rules).toContain("request.resource.data.get('nextMediaOrder', 0) == resource.data.get('nextMediaOrder', 0) + 1");
        expect(rules).toContain('return hasTeamMediaUploadGrant(teamId) &&');
        expect(rules).toContain('canUploadTeamMediaFolder(teamId, data.folderId)');
        expect(rules).toContain("data.type in ['photo', 'file']");
        expect(rules).toContain('isAllowedTeamMediaUploadType(data.mimeType)');
        expect(mediaRules).toContain('allow delete: if isTeamOwnerOrAdmin(teamId);');
    });
});
