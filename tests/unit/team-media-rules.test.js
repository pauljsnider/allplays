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

function canReadTeamDocumentRule() {
    const start = rules.indexOf('function canReadTeamDocument(data) {');
    const end = rules.indexOf('function isTeamOwnerOrGlobalAdmin(teamId) {', start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    return rules.slice(start, end);
}

function canListManagedTeamDocumentRule() {
    const start = rules.indexOf('function canListManagedTeamDocument(data) {');
    const end = rules.indexOf('function canReadTeamDocument(data) {', start);

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

function teamMediaManagerTeamReadWouldBeAllowed(data, userId) {
    const permission = data.teamPermissions?.teamMediaManagement ?? {};
    return permission.mode === 'selected' &&
        Array.isArray(permission.memberIds) &&
        permission.memberIds.includes(userId);
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

    it('allows selected team media managers to get private team documents without opening team lists', () => {
        const readRule = canReadTeamDocumentRule();
        const listRule = canListManagedTeamDocumentRule();

        expect(rules).toContain('function canReadTeamMediaManagerTeamDocument(data) {');
        expect(rules).toContain("data.get('teamPermissions', {}).get('teamMediaManagement', {})");
        expect(rules).toContain("permission.get('mode', '') == 'selected'");
        expect(rules).toContain("request.auth.uid in permission.get('memberIds', [])");
        expect(readRule).toContain('canReadTeamMediaManagerTeamDocument(data)');
        expect(listRule).not.toContain('canReadTeamMediaManagerTeamDocument(data)');
        expect(rules).toContain('allow get: if canReadTeamDocument(resource.data);');
        expect(rules).toContain('canListManagedTeamDocument(resource.data);');

        expect(teamMediaManagerTeamReadWouldBeAllowed({
            isPublic: false,
            teamPermissions: {
                teamMediaManagement: {
                    mode: 'selected',
                    memberIds: ['media-manager']
                }
            }
        }, 'media-manager')).toBe(true);
        expect(teamMediaManagerTeamReadWouldBeAllowed({
            isPublic: false,
            teamPermissions: {
                teamMediaManagement: {
                    mode: 'selected',
                    memberIds: ['other-user']
                }
            }
        }, 'media-manager')).toBe(false);
        expect(teamMediaManagerTeamReadWouldBeAllowed({
            isPublic: false,
            teamPermissions: {
                teamMediaManagement: {
                    mode: 'all',
                    memberIds: ['media-manager']
                }
            }
        }, 'media-manager')).toBe(false);
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
        expect(mediaRules).toContain('allow create, delete: if canManageTeamMedia(teamId);');
        expect(mediaRules).toContain('allow update: if canManageTeamMedia(teamId) || isTeamMediaUploadCounterUpdate(teamId);');
        expect(mediaRules).toContain('allow read: if canReadTeamMediaItem(teamId, resource.data);');
        expect(mediaRules).toContain('allow create: if canManageTeamMedia(teamId) || isTeamMediaUploadCreate(teamId, request.resource.data);');
        expect(mediaRules).toContain('allow update: if canManageTeamMedia(teamId) || isOwnTeamMediaUploadSoftDelete(teamId) || isTeamMediaTitleUpdate(teamId);');
        expect(rules).toContain('function canManageTeamMedia(teamId) {');
        expect(rules).toContain("teamPermission(teamId, 'teamMediaManagement').get('mode', '') == 'selected'");
        expect(rules).toContain("request.auth.uid in teamPermission(teamId, 'teamMediaManagement').get('memberIds', [])");
        expect(rules).toContain("teamId in get(userPath).data.get('teamMediaUploadTeamIds', [])");
        expect(rules).toContain("teamId in get(userPath).data.get('mediaUploadTeamIds', [])");
        expect(rules).toContain('function isTeamMediaUploadCounterUpdate(teamId) {');
        expect(rules).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['nextMediaOrder', 'updatedAt'])");
        expect(rules).toContain("request.resource.data.get('nextMediaOrder', 0) == resource.data.get('nextMediaOrder', 0) + 1");
        expect(uploadCreateRule).toContain('return hasTeamMediaUploadGrant(teamId) &&');
        expect(uploadCreateRule).toContain('canUploadTeamMediaFolder(teamId, data.folderId)');
        expect(uploadCreateRule).toContain("data.type in ['photo', 'file']");
        expect(uploadCreateRule).toContain('isAllowedTeamMediaUploadType(data.mimeType)');
        expect(mediaRules).toContain('allow delete: if canManageTeamMedia(teamId);');
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
