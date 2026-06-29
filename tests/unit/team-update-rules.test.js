import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

describe('team update Firestore rules', () => {
    it('keeps owner-controlled privilege fields immutable on team updates', () => {
        expect(rules).toContain('function keepsOwnerControlledTeamPrivilegeFieldsImmutable()');
        expect(rules).toContain("request.resource.data.get('ownerId', '') == resource.data.get('ownerId', '')");
        expect(rules).toContain("request.resource.data.get('isAdmin', false) == resource.data.get('isAdmin', false)");
        expect(rules).toContain("request.resource.data.get('isPlatformAdmin', false) == resource.data.get('isPlatformAdmin', false)");
    });

    it('allows ordinary team admins to save normalized legacy adminEmails without expanding the list', () => {
        expect(rules).toContain('function keepsCurrentAdminInNormalizedAdminEmailList()');
        expect(rules).toContain("request.resource.data.get('adminEmails', []) == resource.data.get('adminEmails', [])");
        expect(rules).toContain('request.auth.token.email.lower() in existingAdminEmails');
        expect(rules).toContain('request.auth.token.email.lower() in nextAdminEmails');
        expect(rules).toContain('nextAdminEmails.size() <= existingAdminEmails.size()');
        expect(rules).toContain('(isTeamOwnerOrAdmin(teamId) && keepsTeamPrivilegeFieldsImmutable())');
    });

    it('keeps owner and global admin updates available for adminEmails changes', () => {
        expect(rules).toContain('function isTeamOwnerOrGlobalAdmin(teamId)');
        expect(rules).toContain('get(/databases/$(database)/documents/teams/$(teamId)).data.ownerId == request.auth.uid');
        expect(rules).toContain('isGlobalAdmin());');
        expect(rules).toContain('(isTeamOwnerOrGlobalAdmin(teamId) && keepsOwnerControlledTeamPrivilegeFieldsImmutable())');
    });
});
