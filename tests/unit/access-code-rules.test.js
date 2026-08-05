import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const accessCodeMatch = rules.match(/match \/accessCodes\/\{codeId\} \{[\s\S]*?\n\s*\}/);
const accessCodeRules = accessCodeMatch?.[0] || '';
const parentInviteRedemptionMatch = rules.match(/function isParentInviteRedemptionUpdate\(\) \{[\s\S]*?\n    \}/);
const parentInviteRedemptionRule = parentInviteRedemptionMatch?.[0] || '';
const standardCodeRedemptionMatch = rules.match(/function isStandardAccessCodeRedemptionUpdate\(\) \{[\s\S]*?\n    \}/);
const standardCodeRedemptionRule = standardCodeRedemptionMatch?.[0] || '';

describe('access code Firestore rules', () => {
    it('removes the public accessCodes read loophole and scopes raw access to authorized users', () => {
        expect(accessCodeRules).toContain('match /accessCodes/{codeId}');
        expect(rules).toContain('function canReadAccessCode(data)');
        expect(rules).toContain("data.generatedBy == request.auth.uid");
        expect(rules).toContain("request.auth.token.email.lower() == data.email.lower()");
        expect(rules).toContain("request.auth.token.phone_number == data.phone");
        expect(rules).toContain('isTeamOwnerOrAdmin(data.teamId)');
        expect(accessCodeRules).toContain('allow get: if resource == null || canReadAccessCode(resource.data);');
        expect(rules).not.toContain('canGetPhoneOnlyFriendInviteAccessCode');
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
        expect(rules).toContain("'code', 'type', 'generatedBy', 'email', 'phone', 'createdAt', 'used', 'usedBy', 'usedAt'");
        expect(rules).toContain("(!data.keys().hasAny(['type']) || data.type == 'standard')");
        expect(accessCodeRules).toContain("!request.resource.data.keys().hasAny(['type']) ||");
        expect(accessCodeRules).toContain("request.resource.data.type == 'standard'");
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

    it('keeps roster-invite idempotency records manager-only and separate from secret random codes', () => {
        expect(rules).toContain('match /inviteIdempotency/{idempotencyId}');
        expect(rules).toContain('allow read: if isTeamOwnerOrAdmin(teamId);');
        expect(rules).toContain("request.resource.data.keys().hasOnly([\n                                 'accessCode', 'type', 'playerId', 'email'");
        expect(rules).toContain("request.resource.data.type == 'parent_invite'");
        expect(rules).toContain('request.resource.data.generatedBy == request.auth.uid');
        expect(rules).toContain('allow delete: if false;');
    });

    it('requires co-parent invite creation to use the protected callable', () => {
        expect(rules).not.toContain('function isCoParentInvitePayloadValid(data)');
        expect(accessCodeRules).not.toContain("request.resource.data.get('type', null) == 'coparent_invite'");
        expect(accessCodeRules).not.toContain('isCoParentInvitePayloadValid(request.resource.data)');
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
        expect(accessCodeRules).toContain('isStandardAccessCodeRedemptionUpdate()');
        expect(standardCodeRedemptionRule).toContain("let codeType = resource.data.get('type', null);");
        expect(standardCodeRedemptionRule).toContain('let isLegacyStandardCode = codeType == null');
        expect(standardCodeRedemptionRule).toContain("!resource.data.keys().hasAny([");
        expect(standardCodeRedemptionRule).toContain("'teamId', 'playerId', 'familyMembershipId'");
        expect(standardCodeRedemptionRule).toContain("(codeType == 'standard' || isLegacyStandardCode)");
        expect(standardCodeRedemptionRule).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['used', 'usedBy', 'usedAt'])");
        expect(standardCodeRedemptionRule).toContain('resource.data.used == false');
        expect(standardCodeRedemptionRule).toContain("resource.data.get('status', 'active') != 'revoked'");
        expect(standardCodeRedemptionRule).toContain('request.resource.data.usedBy == request.auth.uid');
        expect(standardCodeRedemptionRule).not.toContain('admin_invite');
        expect(standardCodeRedemptionRule).not.toContain('parent_invite');
        expect(standardCodeRedemptionRule).not.toContain('household_invite');
        expect(standardCodeRedemptionRule).not.toContain('coparent_invite');
    });

    it('keeps typed invite records out of owner-only generic revocation updates', () => {
        const revocationIndex = accessCodeRules.indexOf("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['revoked', 'revokedAt', 'used', 'updatedAt'])");
        expect(revocationIndex).toBeGreaterThanOrEqual(0);

        const revocationBranch = accessCodeRules.slice(revocationIndex - 520, revocationIndex + 180);
        expect(revocationBranch).toContain("resource.data.get('type', null) != 'admin_invite'");
        expect(revocationBranch).toContain("resource.data.get('type', null) != 'parent_invite'");
        expect(revocationBranch).toContain("resource.data.get('type', null) != 'household_invite'");
        expect(revocationBranch).toContain("resource.data.get('type', null) != 'coparent_invite'");
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

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('access code rules engine coverage', () => {
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: `allplays-access-code-rules-${Date.now()}`,
            firestore: { rules }
        });
    }, 30000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await setDoc(doc(firestore, 'teams/team-a'), {
                ownerId: 'owner-a',
                adminEmails: ['team-admin@example.com']
            });
            await setDoc(doc(firestore, 'users/linked-parent'), {
                parentPlayerKeys: ['team-a::player-a']
            });
            await setDoc(doc(firestore, 'users/platform-admin'), {
                isAdmin: true
            });
            await setDoc(doc(firestore, 'accessCodeValidationRateLimits/server-owned'), {
                count: 1,
                resetAt: Date.now() + 60_000
            });
        });
    });

    afterAll(async () => {
        await testEnv?.cleanup();
    });

    function coParentInvitePayload(generatedBy) {
        return {
            code: 'COPE1234',
            type: 'coparent_invite',
            teamId: 'team-a',
            playerId: 'player-a',
            playerName: 'Avery Athlete',
            teamName: 'Tigers',
            email: 'coparent@example.com',
            generatedBy,
            createdAt: Timestamp.now(),
            expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
            used: false,
            usedBy: null,
            usedAt: null
        };
    }

    it('denies rate-limit document reads and writes to signed-in, team-admin, and platform-admin clients', async () => {
        const clients = [
            testEnv.authenticatedContext('signed-in', {
                email: 'signed-in@example.com',
                email_verified: true
            }).firestore(),
            testEnv.authenticatedContext('team-admin', {
                email: 'team-admin@example.com',
                email_verified: true
            }).firestore(),
            testEnv.authenticatedContext('platform-admin', {
                email: 'platform-admin@example.com',
                email_verified: true
            }).firestore()
        ];

        for (const clientDb of clients) {
            await assertFails(getDoc(doc(
                clientDb,
                'accessCodeValidationRateLimits/server-owned'
            )));
            await assertFails(getDocs(collection(
                clientDb,
                'accessCodeValidationRateLimits'
            )));
            await assertFails(setDoc(doc(
                clientDb,
                'accessCodeValidationRateLimits/client-write'
            ), {
                count: 0,
                resetAt: Date.now()
            }));
        }
    });

    it('denies direct co-parent invite creation by a linked parent', async () => {
        const linkedParentDb = testEnv.authenticatedContext('linked-parent', {
            email: 'linked-parent@example.com',
            email_verified: true
        }).firestore();

        await assertFails(setDoc(
            doc(linkedParentDb, 'accessCodes/COPE1234'),
            coParentInvitePayload('linked-parent')
        ));
    });

    it('denies direct co-parent invite creation by another authenticated client', async () => {
        const unrelatedDb = testEnv.authenticatedContext('unrelated-user', {
            email: 'unrelated@example.com',
            email_verified: true
        }).firestore();

        await assertFails(setDoc(
            doc(unrelatedDb, 'accessCodes/COPE1234'),
            coParentInvitePayload('unrelated-user')
        ));
    });

    it('preserves permitted standard and parent invite creation', async () => {
        const userDb = testEnv.authenticatedContext('standard-user', {
            email: 'standard@example.com',
            email_verified: true
        }).firestore();
        const ownerDb = testEnv.authenticatedContext('owner-a', {
            email: 'owner@example.com',
            email_verified: true
        }).firestore();

        await assertSucceeds(setDoc(doc(userDb, 'accessCodes/STANDARD1'), {
            code: 'STANDARD1',
            type: 'standard',
            generatedBy: 'standard-user',
            createdAt: Timestamp.now(),
            used: false,
            usedBy: null,
            usedAt: null
        }));
        await assertSucceeds(setDoc(doc(ownerDb, 'accessCodes/PARENT12'), {
            code: 'PARENT12',
            type: 'parent_invite',
            teamId: 'team-a',
            playerId: 'player-a',
            generatedBy: 'owner-a',
            createdAt: Timestamp.now(),
            expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
            used: false,
            usedBy: null,
            usedAt: null
        }));
    });
});
