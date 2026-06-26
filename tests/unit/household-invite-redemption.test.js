import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function extractFunction(source, signature) {
    const start = source.indexOf(signature);
    expect(start, `Expected function signature to exist: ${signature}`).toBeGreaterThanOrEqual(0);

    const braceStart = source.indexOf('{', start);
    expect(braceStart, `Expected opening brace for: ${signature}`).toBeGreaterThanOrEqual(0);

    let depth = 1;
    let end = -1;
    for (let index = braceStart + 1; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            end = index;
            break;
        }
    }

    expect(end, `Expected closing brace for: ${signature}`).toBeGreaterThan(braceStart);
    return source.slice(start, end + 1);
}

describe('household invite redemption guards', () => {
    it('requires the redemption validator to compare organizer, membership status, invited email, and player linkage', () => {
        const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

        expect(source).toContain('export function doesHouseholdInviteFamilyMembershipMatch(codeData = {}, membershipData = {})');
        expect(source).toContain("['pending', 'active'].includes(membershipStatus)");
        expect(source).toContain('normalizeHouseholdInviteEmail(membershipData?.email) === normalizeHouseholdInviteEmail(codeData?.email)');
        expect(source).toContain("String(membershipData?.teamId || '').trim() === String(codeData?.teamId || '').trim()");
        expect(source).toContain("String(membershipData?.playerId || '').trim() === String(codeData?.playerId || '').trim()");
        expect(source).toContain('membershipOrganizerUserId === organizerUserId');
    });

    it('verifies redeemHouseholdInvite checks the family membership before granting parent access', () => {
        const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
        const redeemSource = extractFunction(source, 'export async function redeemHouseholdInvite(');

        expect(redeemSource).toContain("const membershipRef = doc(db, 'users', codeData.organizerUserId, 'familyMemberships', codeData.familyMembershipId);");
        expect(redeemSource).toContain('doesHouseholdInviteFamilyMembershipMatch(codeData, rollbackState.priorMembershipSnapshot.data() || {})');
        expect(redeemSource).toContain('This household invite is no longer valid for that player and email. Ask the organizer to send a new invite.');
    });
});
