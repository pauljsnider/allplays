import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('team media Firestore rules', () => {
    it('defines team media folders and items under teams', () => {
        expect(rules).toContain('match /mediaFolders/{folderId}');
        expect(rules).toContain('match /mediaItems/{itemId}');
    });

    it('limits writes to team owners/admins and reads to team chat access', () => {
        const mediaRulesStart = rules.indexOf('match /mediaFolders/{folderId}');
        const mediaRulesEnd = rules.indexOf('// Chat messages subcollection', mediaRulesStart);
        const mediaRules = rules.slice(mediaRulesStart, mediaRulesEnd);

        expect(mediaRules).toContain('allow read: if canAccessTeamChat(teamId);');
        expect(mediaRules).toContain('allow create, update, delete: if isTeamOwnerOrAdmin(teamId);');
    });
});
