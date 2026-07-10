import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function extractHandler(source, exportName) {
    const start = source.indexOf(`exports.${exportName} = functions.https.onCall`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextExport = source.indexOf('\nexports.', start + 1);
    return source.slice(start, nextExport === -1 ? source.length : nextExport);
}

describe('authoritative household access revocation', () => {
    it('performs membership, token, invited-user, public projection, and private-player cleanup in one transaction', () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        const handler = extractHandler(source, 'revokeHouseholdMemberAccess');

        expect(handler).toContain("if (!context.auth?.uid)");
        expect(handler).toContain('const organizerUserId = context.auth.uid;');
        expect(handler).toContain('firestore.runTransaction(async (transaction) =>');
        expect(handler).toContain('transaction.get(membershipRef)');
        expect(handler).toContain(".where('familyMembershipId', '==', membershipId)");
        expect(handler).toContain('buildHouseholdAccessRevocationPlan');
        expect(handler).toContain('transaction.set(membershipRef, plan.membershipUpdate, { merge: true });');
        expect(handler).toContain('transaction.set(userRef, {');
        expect(handler).toContain('buildTrustedPublicUserProfileProjectionPayload(nextUserData');
        expect(handler).toContain('transaction.set(privateProfileRef, {');
        expect(handler).toContain('revokedUserId: plan.invitedUserId || null');
    });

    it('routes Parent Dashboard removal through the callable and exposes revoke copy', () => {
        const source = readFileSync(new URL('../../js/family-plan.js', import.meta.url), 'utf8');

        expect(source).toContain("httpsCallable(functions, 'revokeHouseholdMemberAccess')");
        expect(source).toContain('await revokeAccess({ membershipId: memberId })');
        expect(source).toContain('>Revoke access</button>');
        expect(source).not.toContain("updateDoc(memberRef, {\n        status: 'removed'");
    });

    it('blocks organizer-side shell revocation writes so cleanup cannot be bypassed', () => {
        const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
        const familyMembershipBlock = rules.slice(
            rules.indexOf('match /familyMemberships/{memberId}'),
            rules.indexOf('match /householdInvites/{inviteId}')
        );

        expect(familyMembershipBlock).toContain('isFamilyMembershipInviteMetadataUpdate');
        expect(familyMembershipBlock).toContain('isFamilyMembershipAcceptance');
        expect(familyMembershipBlock).not.toContain('isFamilyMembershipRemoval');
        expect(rules).not.toContain('function isFamilyMembershipRemoval');
    });
});
