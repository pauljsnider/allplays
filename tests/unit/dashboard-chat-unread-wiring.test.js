import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('dashboard chat unread wiring', () => {
    it('passes participant and moderator lookup context from the coach dashboard', () => {
        const html = readRepoFile('dashboard.html');

        expect(html).toContain('const unreadLookupUser = {');
        expect(html).toContain('email: user.email || null');
        expect(html).not.toContain('email: user.email || user.profileEmail');
        expect(html).not.toContain('email: user.email || profile?.email');
        expect(html).toContain('const conversationLookupByTeam = allTeams.reduce((acc, team) => {');
        expect(html).toContain("canModerate: team._access === 'full'");
        expect(html).toContain('await getUnreadChatCounts(user.uid, teamIds, { conversationLookupByTeam })');
        expect(html).not.toContain('await getUnreadChatCounts(user.uid, teamIds) : {}');
    });

    it('keeps Firebase Auth email authoritative for dashboard team access', () => {
        const html = readRepoFile('dashboard.html');
        const authJs = readRepoFile('js/auth.js');

        // checkAuth() (js/auth.js) is the sole place that merges profile.email onto
        // the user object now — dashboard.html no longer refetches the profile
        // itself, so it must not reintroduce a competing assignment.
        expect(authJs).toContain('user.profileEmail = profile.email;');
        expect(html).not.toContain('profile.email');
        expect(html).not.toContain('user.email = profile.email;');
        expect(html).toContain('getUserTeamsWithAccess(user.uid, user.email, { timeoutMs: 10000 })');
        expect(html).not.toContain('getUserTeamsWithAccess(user.uid, user.email || profile?.email)');
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
