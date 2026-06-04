import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildChatAttachmentFallbackPath, buildGameClipFallbackPath } from '../../js/fallback-media-paths.js';

const rules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');
const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function extractRuleBlock(startMarker) {
    const start = rules.indexOf(startMarker);
    expect(start).toBeGreaterThan(-1);
    const end = rules.indexOf('match /', start + startMarker.length);
    return rules.slice(start, end === -1 ? undefined : end);
}

const chatFallbackRules = extractRuleBlock('match /stat-sheets/team-chat/{teamId}/{userId}/{fileName}');
const clipFallbackRules = extractRuleBlock('match /game-clips/{teamId}/{gameId}/{userId}/{fileName}');
const legacyStatSheetRules = extractRuleBlock('match /stat-sheets/{fileName=**}');
const legacyGameClipRules = extractRuleBlock('match /game-clips/{fileName=**}');

function canAccessTeamMedia({ authUid, isTeamAdmin = false, isTeamParent = false }) {
    return authUid !== null && (isTeamAdmin || isTeamParent);
}

function canCreateScopedFallback({ authUid, pathUserId, isTeamAdmin = false, isTeamParent = false }) {
    return canAccessTeamMedia({ authUid, isTeamAdmin, isTeamParent }) && authUid === pathUserId;
}

function canDeleteScopedFallback({ authUid, pathUserId, isTeamAdmin = false }) {
    return authUid !== null && (isTeamAdmin || authUid === pathUserId);
}

describe('fallback media paths and Storage rules', () => {
    it('builds team-scoped fallback paths with uploader context', () => {
        expect(buildChatAttachmentFallbackPath('team/alpha', 'user 42', 'my photo (1).png', 1700000000000))
            .toBe('stat-sheets/team-chat/team_alpha/user_42/1700000000000_my_photo_1_.png');
        expect(buildGameClipFallbackPath('team/alpha', 'game 7', 'user 42', 'clip #1.mp4', 1700000000001))
            .toBe('game-clips/team_alpha/game_7/user_42/1700000000001_clip_1.mp4');
        expect(dbSource).toContain('buildChatAttachmentFallbackPath(teamId, userId, file.name, ts)');
        expect(dbSource).toContain('buildGameClipFallbackPath(teamId, gameId, userId, file.name, ts)');
    });

    it('limits fallback chat media access to the same team audience and uploader/admin delete rights', () => {
        expect(chatFallbackRules).toContain('allow get: if canAccessTeamMedia(teamId);');
        expect(chatFallbackRules).toContain('request.auth.uid == userId');
        expect(chatFallbackRules).toContain('allow delete: if isTeamOwnerOrAdmin(teamId) || request.auth.uid == userId;');

        expect(canAccessTeamMedia({ authUid: 'coach-1', isTeamAdmin: true })).toBe(true);
        expect(canAccessTeamMedia({ authUid: 'parent-1', isTeamParent: true })).toBe(true);
        expect(canAccessTeamMedia({ authUid: 'parent-2', isTeamParent: false })).toBe(false);

        expect(canCreateScopedFallback({ authUid: 'parent-1', pathUserId: 'parent-1', isTeamParent: true })).toBe(true);
        expect(canCreateScopedFallback({ authUid: 'parent-2', pathUserId: 'parent-1', isTeamParent: true })).toBe(false);
        expect(canDeleteScopedFallback({ authUid: 'coach-1', pathUserId: 'parent-1', isTeamAdmin: true })).toBe(true);
        expect(canDeleteScopedFallback({ authUid: 'parent-2', pathUserId: 'parent-1' })).toBe(false);
    });

    it('denies unrelated signed-in users from scoped game clip reads and deletes', () => {
        expect(clipFallbackRules).toContain('allow get: if canAccessTeamMedia(teamId);');
        expect(clipFallbackRules).toContain("request.resource.contentType.matches('video/.*')");
        expect(clipFallbackRules).toContain('allow delete: if isTeamOwnerOrAdmin(teamId) || request.auth.uid == userId;');

        expect(canAccessTeamMedia({ authUid: 'coach-1', isTeamAdmin: true })).toBe(true);
        expect(canAccessTeamMedia({ authUid: 'outsider-1' })).toBe(false);
        expect(canDeleteScopedFallback({ authUid: 'uploader-1', pathUserId: 'uploader-1' })).toBe(true);
        expect(canDeleteScopedFallback({ authUid: 'outsider-1', pathUserId: 'uploader-1' })).toBe(false);
    });

    it('narrows legacy stat-sheet and game-clip prefixes so nested fallback paths are not open to any signed-in user', () => {
        expect(legacyStatSheetRules).toContain("allow get, create, delete: if isSignedIn() && !fileName.matches('.*/.*');");
        expect(legacyGameClipRules).toContain("allow get, create, delete: if isSignedIn() && !fileName.matches('.*/.*');");
    });
});
