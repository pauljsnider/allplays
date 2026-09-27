import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

describe('team update Firestore rules', () => {
    it('keeps owner-controlled privilege fields immutable on team updates', () => {
        expect(rules).toContain('function keepsOwnerControlledTeamPrivilegeFieldsImmutable()');
        expect(rules).toContain('function keepsTeamFieldImmutable(k, v)');
        expect(rules).toContain("keepsTeamFieldImmutable('ownerId', '')");
        expect(rules).toContain("keepsTeamFieldImmutable('isAdmin', false)");
        expect(rules).toContain("keepsTeamFieldImmutable('isPlatformAdmin', false)");
    });

    it('preserves the server-owned Diamond sport invariant across every client team update', () => {
        expect(rules).toContain('function effectiveTeamSportForDiamond(data)');
        expect(rules).toContain('function keepsDiamondTeamSportConsistent()');
        expect(rules).toContain("settings.get('enabled', false) != true");
        expect(rules).toContain('nextSport == effectiveTeamSportForDiamond(resource.data)');
        expect(rules).toContain("settings.get('sport', '') in ['baseball', 'fastpitch']");
        expect(rules).toContain("'^ *(softball|fastpitch([ _-]+softball)?) *$'");
        expect(rules).toContain('keepsDiamondTeamSportConsistent() &&');
    });

    it('requires ordinary team admins to preserve the exact adminEmails grant set', () => {
        expect(rules).toContain("keepsTeamFieldImmutable('ownerEmail', '')");
        expect(rules).toContain("keepsTeamFieldImmutable('ownerEmailLower', '')");
        expect(rules).toContain("keepsTeamFieldImmutable('adminEmails', [])");
        expect(rules).not.toContain('function keepsCurrentAdminInNormalizedAdminEmailList()');
        expect(rules).not.toContain('nextAdminEmails.size() <= existingAdminEmails.size()');
        expect(rules).toContain('(isTeamOwnerOrAdmin(teamId) && keepsTeamPrivilegeFieldsImmutable())');
    });

    it('keeps owner and global admin updates available for adminEmails changes', () => {
        expect(rules).toContain('function isTeamOwnerOrGlobalAdmin(teamId)');
        expect(rules).toContain('get(/databases/$(database)/documents/teams/$(teamId)).data.ownerId == request.auth.uid');
        expect(rules).toContain('isGlobalAdmin());');
        expect(rules).toContain('(isTeamOwnerOrGlobalAdmin(teamId) && keepsOwnerControlledTeamPrivilegeFieldsImmutable())');
    });
});
