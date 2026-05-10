import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('team media Firestore rules', () => {
    it('defines team media folders and items under teams', () => {
        expect(rules).toContain('match /mediaFolders/{folderId}');
        expect(rules).toContain('match /mediaItems/{itemId}');
    });

    it('limits reads to visible albums while preserving controlled photo uploads', () => {
        const mediaRulesStart = rules.indexOf('match /mediaFolders/{folderId}');
        const mediaRulesEnd = rules.indexOf('// Chat messages subcollection', mediaRulesStart);
        const mediaRules = rules.slice(mediaRulesStart, mediaRulesEnd);

        expect(mediaRules).toContain('allow read: if canReadTeamMediaFolder(teamId, resource.data);');
        expect(mediaRules).toContain('allow read: if canReadTeamMediaItem(teamId, resource.data);');
        expect(mediaRules).toContain('allow create: if isTeamOwnerOrAdmin(teamId) || isTeamMediaPhotoCreate(teamId, request.resource.data);');
        expect(mediaRules).toContain('allow update: if isTeamOwnerOrAdmin(teamId) || isOwnTeamMediaPhotoSoftDelete(teamId);');
        expect(mediaRules).toContain('allow delete: if isTeamOwnerOrAdmin(teamId);');
    });
});
