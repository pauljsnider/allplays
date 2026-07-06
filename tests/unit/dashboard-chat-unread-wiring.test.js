import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('dashboard chat unread wiring', () => {
    it('passes participant and moderator lookup context from the coach dashboard', () => {
        const html = readRepoFile('dashboard.html');

        expect(html).toContain('const unreadLookupUser = {');
        expect(html).toContain('email: user.email || user.profileEmail || profile?.email || null');
        expect(html).toContain('const conversationLookupByTeam = allTeams.reduce((acc, team) => {');
        expect(html).toContain("canModerate: team._access === 'full'");
        expect(html).toContain('await getUnreadChatCounts(user.uid, teamIds, { conversationLookupByTeam })');
        expect(html).not.toContain('await getUnreadChatCounts(user.uid, teamIds) : {}');
    });

    it('passes participant lookup context from the parent dashboard', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain('const unreadLookupUser = {');
        expect(html).toContain('email: user.email || null');
        expect(html).toContain('const conversationLookupByTeam = teamIds.reduce((acc, teamId) => {');
        expect(html).toContain('canModerate: false');
        expect(html).toContain('await getUnreadChatCounts(user.uid, teamIds, { conversationLookupByTeam })');
        expect(html).not.toContain('const unreadCounts = await getUnreadChatCounts(user.uid, teamIds);');
    });
});
