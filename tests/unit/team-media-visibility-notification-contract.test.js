import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    canReadTeamMediaAlbum,
    canViewTeamMediaFolder,
    normalizeAlbumVisibility,
    normalizeTeamMediaFolderDraft
} from '../../js/team-media-utils.js';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('team media visibility notification contract', () => {
    it('keeps member-facing album reads limited to team-visible albums', () => {
        expect(normalizeAlbumVisibility('private')).toBe('private');
        expect(normalizeAlbumVisibility('staff-only')).toBe('team');
        expect(normalizeAlbumVisibility('')).toBe('team');

        expect(canReadTeamMediaAlbum({ visibility: 'team' }, false)).toBe(true);
        expect(canReadTeamMediaAlbum({ visibility: 'private' }, false)).toBe(false);
        expect(canReadTeamMediaAlbum({ visibility: 'private' }, true)).toBe(true);

        expect(canViewTeamMediaFolder({ visibility: 'private' }, 'parent')).toBe(false);
        expect(canViewTeamMediaFolder({ visibility: 'team' }, 'parent')).toBe(true);
        expect(canViewTeamMediaFolder({ visibility: 'private' }, 'full')).toBe(true);
    });

    it('normalizes album drafts through the same visibility vocabulary the gallery reads', () => {
        expect(normalizeTeamMediaFolderDraft({ name: 'Game photos', visibility: 'private' })).toEqual({
            name: 'Game photos',
            visibility: 'private'
        });
        expect(normalizeTeamMediaFolderDraft({ name: 'Highlights', visibility: 'staff-only' })).toEqual({
            name: 'Highlights',
            visibility: 'team'
        });
        expect(() => normalizeTeamMediaFolderDraft({ name: ' ', visibility: 'team' })).toThrow('Album name is required.');
    });

    it('normalizes notification album visibility defensively before selecting recipients', () => {
        expect(functionsSource).toContain('function normalizeNotificationAlbumVisibility(value) {');
        expect(functionsSource).toContain("return ['private', 'staff', 'staff-only'].includes(normalized) ? 'private' : 'team';");
        expect(functionsSource).toContain('function canReceiveCategoryNotification(category, user, audienceContext = {}) {');
        expect(functionsSource).toContain("if (category !== 'media') return true;");
        expect(functionsSource).toContain("const albumVisibility = audienceContext?.staffOnly === true\n    ? 'private'\n    : normalizeNotificationAlbumVisibility(audienceContext.albumVisibility);");
        expect(functionsSource).toContain('function normalizeNotificationAudienceUserIds(value) {');
        expect(functionsSource).toContain('function normalizeNotificationAudienceRoles(value) {');
        expect(functionsSource).toContain('function mediaAudienceAllowsUser(user, audienceContext = {}) {');
        expect(functionsSource).toContain('function hasMediaAudienceConstraints(audienceContext = {}) {');
        expect(functionsSource).toContain("const isStaffUser = Array.isArray(user.roles) && user.roles.includes('staff');");
        expect(functionsSource).toContain("if (!isStaffUser) return false;");
        expect(functionsSource).toContain("if (hasMediaAudienceConstraints(audienceContext)) {\n      return mediaAudienceAllowsUser(user, audienceContext);\n    }");
        expect(functionsSource).toContain('return true;');
    });

    it('passes media audience context through indexed and legacy target lookups', () => {
        expect(functionsSource).toContain('canReceiveCategoryNotification(category, user, audienceContext)');
        expect(functionsSource).toContain('buildIndexedEligibleUsers(indexedRecipientDocs, category, audienceContext, additionalUsers)');
        expect(functionsSource).toContain('getLegacyTargetsForCategory(teamId, category, users, actorUid, audienceContext)');
        expect(functionsSource).toContain('async function getTargetsForCategory(teamId, category, actorUid = null, audienceContext = {}, additionalUsers = []) {');
        expect(functionsSource).toContain('const indexedRecipientDocs = targetSnap.docs || [];');
        expect(functionsSource).toContain('const fallbackTargets = await getLegacyTargetsForCategory(teamId, category, users, actorUid, audienceContext);');
        expect(functionsSource).toContain('audienceContext: metadata.audienceContext || { albumVisibility: metadata.albumVisibility }');
        expect(functionsSource).toContain('folder.allowedUserIds || folder.audienceUserIds || folder.visibleToUserIds || folder.userIds');
        expect(functionsSource).toContain('folder.allowedRoles || folder.audienceRoles || folder.visibleToRoles || folder.roles');
        expect(functionsSource).toContain('...(allowedUserIds.length ? { allowedUserIds } : {})');
        expect(functionsSource).toContain('...(allowedRoles.length ? { allowedRoles } : {})');
        expect(functionsSource).toContain('const audienceContext = buildTeamMediaNotificationAudienceContext({');
        expect(functionsSource).toContain('visibility: folder.visibility || batch.albumVisibility');
        expect(functionsSource).not.toContain("if (albumVisibility !== 'team') return null;");
        expect(functionsSource).not.toContain("await markTeamMediaNotificationBatchSkipped(batchRef, claimId, 'album_not_team_visible');");
    });
});
