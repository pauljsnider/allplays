import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const accessCodeMatch = rules.match(/match \/accessCodes\/\{codeId\} \{[\s\S]*?\n\s*\}/);
const accessCodeRules = accessCodeMatch?.[0] || '';

describe('access code Firestore rules', () => {
    it('removes the public accessCodes read loophole and scopes raw access to authorized users', () => {
        expect(accessCodeRules).toContain('match /accessCodes/{codeId}');
        expect(rules).toContain('function canReadAccessCode(data)');
        expect(rules).toContain("data.generatedBy == request.auth.uid");
        expect(rules).toContain("request.auth.token.email.lower() == data.email.lower()");
        expect(rules).toContain("request.auth.token.phone_number == data.phone");
        expect(rules).toContain('isTeamOwnerOrAdmin(data.teamId)');
        expect(accessCodeRules).toContain('allow get: if resource == null || canReadAccessCode(resource.data);');
        expect(accessCodeRules).toContain('allow list: if canReadAccessCode(resource.data);');
        expect(accessCodeRules).not.toContain('allow read: if true;');
    });

    it('allows signed-in users to read phone-only activation codes for redemption without reopening public reads', () => {
        expect(rules).toContain('request.auth.token.phone_number != null');
        expect(rules).toContain('data.phone is string');
        expect(rules).toContain('request.auth.token.phone_number == data.phone');
        expect(accessCodeRules).not.toMatch(/allow\s+read\s*:\s*if\s+true/);
        expect(accessCodeRules).not.toMatch(/allow\s+list\s*:\s*if\s+true/);
        expect(accessCodeRules).not.toMatch(/allow\s+get\s*:\s*if\s+true/);
    });

    it('blocks self-minted admin invites unless the caller already administers the target team', () => {
        expect(rules).toContain('function isAdminInvitePayloadValid(data)');
        expect(accessCodeRules).toContain("request.resource.data.get('type', null) == 'admin_invite'");
        expect(accessCodeRules).toContain('isTeamOwnerOrAdmin(request.resource.data.teamId)');
        expect(accessCodeRules).toContain('isAdminInvitePayloadValid(request.resource.data)');
        expect(accessCodeRules).toContain('request.resource.data.code == codeId');
        expect(accessCodeRules).not.toContain('allow create: if isSignedIn() && request.resource.data.generatedBy == request.auth.uid;');
    });

    it('prevents creators from updating an existing access code into an admin invite without team-admin authorization', () => {
        expect(accessCodeRules).toContain("request.resource.data.get('type', resource.data.get('type', null)) != 'admin_invite'");
        expect(accessCodeRules).toContain("request.resource.data.get('type', resource.data.get('type', null)) == 'admin_invite'");
        expect(accessCodeRules).toContain('isTeamOwnerOrAdmin(request.resource.data.teamId)');
        expect(accessCodeRules).toContain('isAdminInvitePayloadValid(request.resource.data)');
        expect(accessCodeRules).toContain('request.resource.data.code == codeId');
    });

    it('requires team-admin authorization and an explicit schema for parent_invite creation', () => {
        expect(rules).toContain('function isParentInvitePayloadValid(data)');
        expect(accessCodeRules).toContain("request.resource.data.get('type', null) == 'parent_invite'");
        expect(accessCodeRules).toContain('isTeamOwnerOrAdmin(request.resource.data.teamId)');
        expect(accessCodeRules).toContain('isParentInvitePayloadValid(request.resource.data)');
        expect(accessCodeRules).toContain('request.resource.data.code == codeId');
        expect(rules).toContain("'code', 'type', 'teamId', 'playerId', 'playerNum', 'playerName'");
        expect(rules).toContain("'teamName', 'relation', 'email', 'generatedBy', 'createdAt'");
    });

    it('locks parent_invite targeting to redemption and revoke-only updates', () => {
        expect(rules).toContain('function isParentInviteRedemptionUpdate()');
        expect(rules).toContain("resource.data.get('type', null) == 'parent_invite'");
        expect(rules).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['used', 'usedBy', 'usedAt'])");
        expect(rules).toContain('function isParentInviteRevocationUpdate()');
        expect(rules).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['revoked', 'revokedAt', 'updatedAt'])");
        expect(accessCodeRules).toContain("request.resource.data.get('type', resource.data.get('type', null)) != 'parent_invite'");
        expect(accessCodeRules).toContain("resource.data.get('type', null) != 'parent_invite'");
        expect(accessCodeRules).not.toContain("resource.data.type != 'parent_invite'");
    });

    it('validates the allowed admin_invite payload fields before redemption can trust the record', () => {
        expect(rules).toContain("data.keys().hasOnly([");
        expect(rules).toContain("'code', 'type', 'teamId', 'teamName', 'email', 'generatedBy'");
        expect(rules).toContain("'createdAt', 'expiresAt', 'used', 'usedBy', 'usedAt'");
        expect(rules).toContain("data.type == 'admin_invite'");
        expect(rules).toContain('data.used == false');
        expect(rules).toContain('data.usedBy == null');
        expect(rules).toContain('data.usedAt == null');
    });
});
