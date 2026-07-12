import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const privilegedTeamMediaGrantFields = ['teamMediaUploadTeamIds', 'mediaUploadTeamIds'];

function teamMediaUploadCreateRule() {
    const start = rules.indexOf('function isTeamMediaUploadCreate(teamId, data) {');
    const end = rules.indexOf('function isTeamMediaUploadCounterUpdate(teamId) {', start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    return rules.slice(start, end);
}

function ownerProfileCreateWouldBeAllowed(data) {
    return data.isAdmin !== true &&
        data.isPlatformAdmin !== true &&
        !['parentOf', 'parentTeamIds', 'parentPlayerKeys', 'playerKeys'].some((field) => Object.hasOwn(data, field)) &&
        !privilegedTeamMediaGrantFields.some((field) => Object.hasOwn(data, field));
}

function ownerProfileUpdateWouldBeAllowed(before, after) {
    const affectedKeys = new Set([
        ...Object.keys(before).filter((key) => before[key] !== after[key]),
        ...Object.keys(after).filter((key) => before[key] !== after[key])
    ]);

    return !affectedKeys.has('isAdmin') &&
        !affectedKeys.has('isPlatformAdmin') &&
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
        expect(rules).toContain("data.get('isPlatformAdmin', false) != true");
        expect(rules).toContain("affectedKeys().hasAny(['isAdmin', 'isPlatformAdmin'])");

        expect(ownerProfileCreateWouldBeAllowed({ displayName: 'Parent User' })).toBe(true);
        expect(ownerProfileCreateWouldBeAllowed({ displayName: 'Parent User', isPlatformAdmin: true })).toBe(false);
        expect(ownerProfileCreateWouldBeAllowed({ displayName: 'Parent User', teamMediaUploadTeamIds: ['team-a'] })).toBe(false);
        expect(ownerProfileCreateWouldBeAllowed({ displayName: 'Parent User', mediaUploadTeamIds: ['team-a'] })).toBe(false);
        expect(ownerProfileUpdateWouldBeAllowed({ displayName: 'Old' }, { displayName: 'New' })).toBe(true);
        expect(ownerProfileUpdateWouldBeAllowed({ displayName: 'Old' }, { displayName: 'Old', isPlatformAdmin: true })).toBe(false);
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
        const uploadCreateRule = teamMediaUploadCreateRule();

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
        expect(uploadCreateRule).toContain('return hasTeamMediaUploadGrant(teamId) &&');
        expect(uploadCreateRule).toContain('canUploadTeamMediaFolder(teamId, data.folderId)');
        expect(uploadCreateRule).toContain("data.type in ['photo', 'file']");
        expect(uploadCreateRule).toContain('isAllowedTeamMediaUploadType(data.mimeType)');
        expect(mediaRules).toContain('allow delete: if isTeamOwnerOrAdmin(teamId);');
    });

    it('allows delegated storage-backed uploads without persisted download URLs', () => {
        const uploadCreateRule = teamMediaUploadCreateRule();

        expect(uploadCreateRule).toContain("'folderId', 'title', 'type', 'storagePath', 'uploadedBy'");
        expect(uploadCreateRule).toContain("'folderId', 'title', 'fileName', 'type', 'storagePath', 'uploadedBy'");
        expect(uploadCreateRule).toContain("data.storagePath.matches('team-media/' + teamId + '/' + data.folderId + '/' + request.auth.uid + '/.*')");
        expect(uploadCreateRule).not.toContain("'folderId', 'title', 'type', 'url', 'storagePath', 'uploadedBy'");
        expect(uploadCreateRule).not.toContain("'folderId', 'title', 'fileName', 'type', 'url', 'storagePath', 'uploadedBy'");
        expect(uploadCreateRule).not.toContain('data.url is string');
    });
});
