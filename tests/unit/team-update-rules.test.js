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

    it('prevents ordinary team admins from mutating adminEmails directly', () => {
        expect(rules).toContain('function keepsTeamPrivilegeFieldsImmutable()');
        expect(rules).toContain("request.resource.data.get('adminEmails', []) == resource.data.get('adminEmails', [])");
        expect(rules).toContain('(isTeamOwnerOrAdmin(teamId) && keepsTeamPrivilegeFieldsImmutable())');
    });

    it('keeps owner and global admin updates available for adminEmails changes', () => {
        expect(rules).toContain('function isTeamOwnerOrGlobalAdmin(teamId)');
        expect(rules).toContain('get(/databases/$(database)/documents/teams/$(teamId)).data.ownerId == request.auth.uid');
        expect(rules).toContain('isGlobalAdmin());');
        expect(rules).toContain('(isTeamOwnerOrGlobalAdmin(teamId) && keepsOwnerControlledTeamPrivilegeFieldsImmutable())');
    });
});
