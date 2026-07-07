import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const accessCodeMatch = rules.match(/match \/accessCodes\/\{codeId\} \{[\s\S]*?\n\s*\}/);
const accessCodeRules = accessCodeMatch?.[0] || '';
const parentInviteRedemptionMatch = rules.match(/function isParentInviteRedemptionUpdate\(\) \{[\s\S]*?\n    \}/);
const parentInviteRedemptionRule = parentInviteRedemptionMatch?.[0] || '';

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

    it('preserves standard profile access-code creation without reopening typed invite paths', () => {
        expect(rules).toContain('function isStandardAccessCodePayloadValid(data)');
        expect(rules).toContain("'code', 'generatedBy', 'email', 'phone', 'createdAt', 'used', 'usedBy', 'usedAt'");
        expect(rules).toContain("!data.keys().hasAny(['type'])");
        expect(accessCodeRules).toContain("!request.resource.data.keys().hasAny(['type'])");
        expect(accessCodeRules).toContain('isStandardAccessCodePayloadValid(request.resource.data)');
        expect(accessCodeRules).toContain('request.resource.data.code == codeId');
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
        expect(accessCodeRules).toContain("request.resource.data.get('type', resource.data.get('type', null)) == 'admin_invite'");
        expect(accessCodeRules).toContain('isTeamOwnerOrAdmin(request.resource.data.teamId)');
        expect(accessCodeRules).toContain('isAdminInvitePayloadValid(request.resource.data)');
        expect(accessCodeRules).toContain('request.resource.data.code == codeId');
        expect(accessCodeRules).not.toContain("request.resource.data.generatedBy == request.auth.uid &&\n                         request.resource.data.get('type', resource.data.get('type', null)) != 'admin_invite'");
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
        expect(accessCodeRules).toContain("resource.data.get('type', null) != 'parent_invite'");
        expect(accessCodeRules).toContain("resource.data.get('type', null) != 'household_invite'");
        expect(accessCodeRules).toContain("resource.data.get('type', null) != 'admin_invite'");
        expect(accessCodeRules).not.toContain("resource.data.type != 'parent_invite'");
    });

    it('excludes admin_invite documents from generic used-field redemption updates', () => {
        const genericUsedUpdateIndex = accessCodeRules.indexOf("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['used', 'usedBy', 'usedAt'])");
        expect(genericUsedUpdateIndex).toBeGreaterThanOrEqual(0);

        const genericUsedUpdateBranch = accessCodeRules.slice(genericUsedUpdateIndex - 280, genericUsedUpdateIndex + 220);
        expect(genericUsedUpdateBranch).toContain("resource.data.get('type', null) != 'admin_invite'");
        expect(genericUsedUpdateBranch).toContain("resource.data.get('type', null) != 'parent_invite'");
        expect(genericUsedUpdateBranch).toContain("resource.data.get('type', null) != 'household_invite'");
    });

    it('requires parent_invite redemption to use an active invite owned by the signed-in email', () => {
        expect(parentInviteRedemptionRule).toContain('resource.data.used == false');
        expect(parentInviteRedemptionRule).toContain("resource.data.get('revoked', false) != true");
        expect(parentInviteRedemptionRule).toContain("resource.data.get('active', true) != false");
        expect(parentInviteRedemptionRule).toContain("resource.data.get('status', 'active') != 'removed'");
        expect(parentInviteRedemptionRule).toContain("resource.data.get('status', 'active') != 'cancelled'");
        expect(parentInviteRedemptionRule).toContain("resource.data.get('status', 'active') != 'revoked'");
        expect(parentInviteRedemptionRule).toContain("resource.data.get('expiresAt', null) == null");
        expect(parentInviteRedemptionRule).toContain('resource.data.expiresAt > request.time');
        expect(parentInviteRedemptionRule).toContain("!('email' in resource.data)");
        expect(parentInviteRedemptionRule).toContain('request.auth.token.email is string');
        expect(parentInviteRedemptionRule).toContain('request.auth.token.email.lower() == resource.data.email.lower()');
    });

    it('does not let parent_invite redemption rely only on writable key narrowing', () => {
        const affectedKeysIndex = parentInviteRedemptionRule.indexOf("affectedKeys().hasOnly(['used', 'usedBy', 'usedAt'])");
        expect(affectedKeysIndex).toBeGreaterThanOrEqual(0);

        const authorizationGuards = parentInviteRedemptionRule.slice(affectedKeysIndex);
        expect(authorizationGuards).toContain('resource.data.used == false');
        expect(authorizationGuards).toContain("resource.data.get('revoked', false) != true");
        expect(authorizationGuards).toContain("resource.data.get('active', true) != false");
        expect(authorizationGuards).toContain("resource.data.get('status', 'active') != 'revoked'");
        expect(authorizationGuards).toContain('request.auth.token.email.lower() == resource.data.email.lower()');
    });

    it('requires household_invite creation to match an organizer-owned family membership and linked parent scope', () => {
        expect(rules).toContain('function householdInviteMembershipMatches(data)');
        expect(rules).toContain("let membershipPath = /databases/$(database)/documents/users/$(request.auth.uid)/familyMemberships/$(data.familyMembershipId);");
        expect(rules).toContain("get(membershipPath).data.email == data.email");
        expect(rules).toContain("get(membershipPath).data.teamId == data.teamId");
        expect(rules).toContain("get(membershipPath).data.playerId == data.playerId");
        expect(rules).toContain("get(membershipPath).data.status in ['pending', 'active']");
        expect(rules).toContain('function isHouseholdInviteAccessCodePayloadValid(data)');
        expect(rules).toContain("data.type == 'household_invite'");
        expect(rules).toContain('householdInviteMembershipMatches(data)');
        expect(rules).toContain('isParentForPlayer(data.teamId, data.playerId)');
        expect(accessCodeRules).toContain("request.resource.data.get('type', null) == 'household_invite'");
        expect(accessCodeRules).toContain('isHouseholdInviteAccessCodePayloadValid(request.resource.data)');
        expect(accessCodeRules).not.toContain("request.resource.data.get('type', null) != 'admin_invite' &&\n                          request.resource.data.get('type', null) != 'parent_invite'");
    });

    it('locks household_invite updates to invited-email redemption or organizer revocation', () => {
        expect(rules).toContain('function isHouseholdInviteRedemptionUpdate()');
        expect(rules).toContain("resource.data.get('type', null) == 'household_invite'");
        expect(rules).toContain("request.auth.token.email.lower() == resource.data.email.lower()");
        expect(rules).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['used', 'usedBy', 'usedAt'])");
        expect(rules).toContain('function isHouseholdInviteRevocationUpdate()');
        expect(rules).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['revoked', 'revokedAt', 'used', 'updatedAt'])");
        expect(accessCodeRules).toContain('isHouseholdInviteRedemptionUpdate()');
        expect(accessCodeRules).toContain('isHouseholdInviteRevocationUpdate()');
        expect(accessCodeRules).toContain("resource.data.get('type', null) != 'household_invite'");
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
