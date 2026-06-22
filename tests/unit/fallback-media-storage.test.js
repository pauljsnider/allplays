import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildChatAttachmentFallbackPath, buildDrillDiagramFallbackPath, buildGameClipFallbackPath, buildStatSheetFallbackPath } from '../../js/fallback-media-paths.js';

const rules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');
const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function extractRuleBlock(startMarker) {
    const start = rules.indexOf(startMarker);
    expect(start).toBeGreaterThan(-1);
    const end = rules.indexOf('match /', start + startMarker.length);
    return rules.slice(start, end === -1 ? undefined : end);
}

const chatFallbackRules = extractRuleBlock('match /stat-sheets/team-chat/{teamId}/{conversationId}/{userId}/{fileName}');
const legacyChatFallbackRules = extractRuleBlock('match /stat-sheets/team-chat/{teamId}/{userId}/{fileName}');
const statSheetFallbackRules = extractRuleBlock('match /stat-sheets/team-games/{teamId}/{userId}/{fileName}');
const drillFallbackRules = extractRuleBlock('match /stat-sheets/drills/{teamId}/{drillId}/{userId}/{fileName}');
const clipFallbackRules = extractRuleBlock('match /game-clips/{teamId}/{gameId}/{userId}/{fileName}');
const legacyStatSheetRules = extractRuleBlock('match /stat-sheets/{fileName}');
const legacyGameClipRules = extractRuleBlock('match /game-clips/{fileName}');

function canAccessTeamMedia({ authUid, isTeamAdmin = false, isTeamParent = false }) {
    return authUid !== null && (isTeamAdmin || isTeamParent);
}

function canAccessChatAttachment({ authUid, conversationId = 'team', isTeamAdmin = false, isTeamParent = false, isParticipant = false }) {
    return canAccessTeamMedia({ authUid, isTeamAdmin, isTeamParent }) &&
        (conversationId === 'team' || isTeamAdmin || isParticipant);
}

function canCreateScopedFallback({ authUid, pathUserId, conversationId = 'team', isTeamAdmin = false, isTeamParent = false, isParticipant = false }) {
    return canAccessChatAttachment({ authUid, conversationId, isTeamAdmin, isTeamParent, isParticipant }) && authUid === pathUserId;
}

function canDeleteScopedFallback({ authUid, pathUserId, isTeamAdmin = false }) {
    return authUid !== null && (isTeamAdmin || authUid === pathUserId);
}

function canAccessLegacyGameClipFallback({ authUid }) {
    return authUid !== null && false;
}

describe('fallback media paths and Storage rules', () => {
    it('builds team-scoped fallback paths with uploader context', () => {
        expect(buildChatAttachmentFallbackPath('team/alpha', 'group user 42', 'user 42', 'my photo (1).png', 1700000000000))
            .toBe('stat-sheets/team-chat/team_alpha/group_user_42/user_42/1700000000000_my_photo_1_.png');
        expect(buildChatAttachmentFallbackPath('team/alpha', 'group_user%3Acoach-1', 'user 42', 'my photo (1).png', 1700000000000))
            .toBe('stat-sheets/team-chat/team_alpha/group_user%3Acoach-1/user_42/1700000000000_my_photo_1_.png');
        expect(buildStatSheetFallbackPath('team/alpha', 'user 42', 'box score (1).png', 1700000000001))
            .toBe('stat-sheets/team-games/team_alpha/user_42/1700000000001_box_score_1_.png');
        expect(buildDrillDiagramFallbackPath('team/alpha', 'drill 7', 'user 42', 'diagram #1.png', 1700000000002))
            .toBe('stat-sheets/drills/team_alpha/drill_7/user_42/1700000000002_diagram_1.png');
        expect(buildGameClipFallbackPath('team/alpha', 'game 7', 'user 42', 'clip #1.mp4', 1700000000001))
            .toBe('game-clips/team_alpha/game_7/user_42/1700000000001_clip_1.mp4');
        expect(dbSource).toContain('buildChatAttachmentFallbackPath(teamId, conversationId, userId, file.name, ts)');
        expect(dbSource).toContain('buildStatSheetFallbackPath(teamId, userId, file.name, Date.now())');
        expect(dbSource).toContain('buildDrillDiagramUploadPaths(teamId, drillId, userId, file?.name, Date.now())');
        expect(dbSource).toContain('buildGameClipFallbackPath(teamId, gameId, userId, file.name, ts)');
    });

    it('limits fallback chat media access to the same team audience and uploader/admin delete rights', () => {
        expect(chatFallbackRules).toContain('allow get: if canAccessChatAttachment(teamId, conversationId);');
        expect(rules).toContain("('user:' + request.auth.uid) in participantIds");
        expect(rules).toContain("('email:' + request.auth.token.email.lower()) in participantIds");
        expect(chatFallbackRules).toContain('request.auth.uid == userId');
        expect(chatFallbackRules).toContain('allow delete: if isTeamOwnerOrAdmin(teamId) || request.auth.uid == userId;');
        expect(legacyChatFallbackRules).toContain('allow get: if isTeamOwnerOrAdmin(teamId) || request.auth.uid == userId;');
        expect(legacyChatFallbackRules).toContain('allow create: if false;');

        expect(canAccessTeamMedia({ authUid: 'coach-1', isTeamAdmin: true })).toBe(true);
        expect(canAccessTeamMedia({ authUid: 'parent-1', isTeamParent: true })).toBe(true);
        expect(canAccessTeamMedia({ authUid: 'parent-2', isTeamParent: false })).toBe(false);
        expect(canAccessChatAttachment({ authUid: 'parent-1', conversationId: 'direct-1', isTeamParent: true, isParticipant: true })).toBe(true);
        expect(canAccessChatAttachment({ authUid: 'parent-2', conversationId: 'direct-1', isTeamParent: true, isParticipant: false })).toBe(false);

        expect(canCreateScopedFallback({ authUid: 'parent-1', pathUserId: 'parent-1', isTeamParent: true })).toBe(true);
        expect(canCreateScopedFallback({ authUid: 'parent-1', pathUserId: 'parent-1', conversationId: 'direct-1', isTeamParent: true, isParticipant: true })).toBe(true);
        expect(canCreateScopedFallback({ authUid: 'parent-1', pathUserId: 'parent-1', conversationId: 'direct-1', isTeamParent: true })).toBe(false);
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

    it('limits stat sheet and drill fallback access to team-scoped readers and uploader/admin writes', () => {
        expect(statSheetFallbackRules).toContain('allow get: if canAccessTeamMedia(teamId);');
        expect(statSheetFallbackRules).toContain('request.auth.uid == userId');
        expect(statSheetFallbackRules).toContain('allow delete: if isTeamOwnerOrAdmin(teamId) || request.auth.uid == userId;');

        expect(drillFallbackRules).toContain('allow get: if canAccessTeamMedia(teamId);');
        expect(drillFallbackRules).toContain('drillId.size() > 0');
        expect(drillFallbackRules).toContain('request.auth.uid == userId');
        expect(drillFallbackRules).toContain('allow delete: if isTeamOwnerOrAdmin(teamId) || request.auth.uid == userId;');

        expect(canAccessTeamMedia({ authUid: 'coach-1', isTeamAdmin: true })).toBe(true);
        expect(canAccessTeamMedia({ authUid: 'outsider-1' })).toBe(false);
        expect(canCreateScopedFallback({ authUid: 'scorekeeper-1', pathUserId: 'scorekeeper-1', isTeamParent: true })).toBe(true);
        expect(canCreateScopedFallback({ authUid: 'outsider-1', pathUserId: 'scorekeeper-1' })).toBe(false);
    });

    it('hard-denies legacy flat stat sheet and game clip access', () => {
        expect(legacyStatSheetRules).toContain('match /stat-sheets/{fileName} {');
        expect(legacyStatSheetRules).toContain('allow get, create, delete: if false;');
        expect(legacyGameClipRules).toContain('match /game-clips/{fileName} {');
        expect(legacyGameClipRules).toContain('allow get, create, delete: if false;');

        expect(canAccessLegacyGameClipFallback({ authUid: 'signed-in-user' })).toBe(false);
        expect(canAccessLegacyGameClipFallback({ authUid: null })).toBe(false);
    });
});
