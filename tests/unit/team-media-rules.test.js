import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const privilegedTeamMediaGrantFields = ['teamMediaUploadTeamIds', 'mediaUploadTeamIds'];

function ownerProfileCreateWouldBeAllowed(data) {
    return data.isAdmin !== true &&
        !['parentOf', 'parentTeamIds', 'parentPlayerKeys', 'playerKeys'].some((field) => Object.hasOwn(data, field)) &&
        !privilegedTeamMediaGrantFields.some((field) => Object.hasOwn(data, field));
}

function ownerProfileUpdateWouldBeAllowed(before, after) {
    const affectedKeys = new Set([
        ...Object.keys(before).filter((key) => before[key] !== after[key]),
        ...Object.keys(after).filter((key) => before[key] !== after[key])
    ]);

    return !affectedKeys.has('isAdmin') &&
        !['parentOf', 'parentTeamIds', 'parentPlayerKeys', 'playerKeys'].some((field) => affectedKeys.has(field)) &&
        !privilegedTeamMediaGrantFields.some((field) => affectedKeys.has(field));
}

function hasTeamMediaUploadGrant(profile, teamId) {
    return (profile.teamMediaUploadTeamIds ?? []).includes(teamId) ||
        (profile.mediaUploadTeamIds ?? []).includes(teamId);
}

describe('team media Firestore rules', () => {
    it('defines team media folders and items under teams', () => {
        expect(rules).toContain('match /mediaFolders/{folderId}');
        expect(rules).toContain('match /mediaItems/{itemId}');
    });

    it('blocks owners from self-writing team media upload grant fields on profiles', () => {
        expect(rules).toContain("function teamMediaUploadGrantFields() {");
        expect(rules).toContain("return ['teamMediaUploadTeamIds', 'mediaUploadTeamIds'];");
        expect(rules).toContain('!data.keys().hasAny(teamMediaUploadGrantFields())');
        expect(rules).toContain('!request.resource.data.diff(resource.data).affectedKeys().hasAny(teamMediaUploadGrantFields())');

        expect(ownerProfileCreateWouldBeAllowed({ displayName: 'Parent User' })).toBe(true);
        expect(ownerProfileCreateWouldBeAllowed({ displayName: 'Parent User', teamMediaUploadTeamIds: ['team-a'] })).toBe(false);
        expect(ownerProfileCreateWouldBeAllowed({ displayName: 'Parent User', mediaUploadTeamIds: ['team-a'] })).toBe(false);
        expect(ownerProfileUpdateWouldBeAllowed({ displayName: 'Old' }, { displayName: 'New' })).toBe(true);
        expect(ownerProfileUpdateWouldBeAllowed({ displayName: 'Old' }, { displayName: 'Old', teamMediaUploadTeamIds: ['team-a'] })).toBe(false);
        expect(ownerProfileUpdateWouldBeAllowed({ displayName: 'Old' }, { displayName: 'Old', mediaUploadTeamIds: ['team-a'] })).toBe(false);
        expect(ownerProfileUpdateWouldBeAllowed({ displayName: 'Old', teamMediaUploadTeamIds: ['team-a'] }, { displayName: 'Old' })).toBe(false);
    });

    it('models denied self-grants as unable to unlock team media creates', () => {
        const nonMemberProfile = { uid: 'non-member' };
        const selfGrantedProfile = { uid: 'non-member', teamMediaUploadTeamIds: ['team-a'], mediaUploadTeamIds: ['team-a'] };

        expect(ownerProfileUpdateWouldBeAllowed(nonMemberProfile, selfGrantedProfile)).toBe(false);
        expect(hasTeamMediaUploadGrant(nonMemberProfile, 'team-a')).toBe(false);
        expect(hasTeamMediaUploadGrant({ uid: 'contributor', teamMediaUploadTeamIds: ['team-a'] }, 'team-a')).toBe(true);
        expect(hasTeamMediaUploadGrant({ uid: 'legacy-contributor', mediaUploadTeamIds: ['team-a'] }, 'team-a')).toBe(true);
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
