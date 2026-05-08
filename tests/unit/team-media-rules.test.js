import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('team media Firestore rules', () => {
    it('defines team media folders and video-link items under teams', () => {
        expect(rules).toContain('match /mediaFolders/{folderId}');
        expect(rules).toContain('match /items/{itemId}');
        expect(rules).toContain("request.resource.data.type == 'video_link'");
    });

    it('limits writes to team owners/admins and hides manager folders from team members', () => {
        const mediaRulesStart = rules.indexOf('match /mediaFolders/{folderId}');
        const mediaRulesEnd = rules.indexOf('// Chat messages subcollection', mediaRulesStart);
        const mediaRules = rules.slice(mediaRulesStart, mediaRulesEnd);

        expect(mediaRules).toContain('allow create: if isTeamOwnerOrAdmin(teamId)');
        expect(mediaRules).toContain('allow update: if isTeamOwnerOrAdmin(teamId)');
        expect(mediaRules).toContain("resource.data.get('visibility', 'members') == 'members'");
        expect(mediaRules).toContain("get(/databases/$(database)/documents/teams/$(teamId)/mediaFolders/$(folderId)).data.get('visibility', 'members') == 'members'");
    });
});
