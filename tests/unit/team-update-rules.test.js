import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

describe('team update Firestore rules', () => {
    it('keeps ownership and privilege fields immutable on team updates', () => {
        expect(rules).toContain('function keepsTeamPrivilegeFieldsImmutable()');
        expect(rules).toContain("request.resource.data.get('ownerId', '') == resource.data.get('ownerId', '')");
        expect(rules).toContain("request.resource.data.get('isAdmin', false) == resource.data.get('isAdmin', false)");
        expect(rules).toContain("request.resource.data.get('isPlatformAdmin', false) == resource.data.get('isPlatformAdmin', false)");
        expect(rules).toContain('allow update: if isTeamOwnerOrAdmin(teamId) && keepsTeamPrivilegeFieldsImmutable();');
    });
});
