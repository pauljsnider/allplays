import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const familyShareTokenMatch = rules.match(/match \/familyShareTokens\/\{tokenId\} \{[\s\S]*?\n\s*}/);
const familyShareTokenRules = familyShareTokenMatch?.[0] || '';

describe('family share token Firestore rules', () => {
    it('allows anonymous reads for legacy tokens that omit the active field', () => {
        expect(familyShareTokenRules).toContain("match /familyShareTokens/{tokenId}");
        expect(familyShareTokenRules).toContain("resource.data.get('active', true) == true");
        expect(familyShareTokenRules).toContain("resource.data.ownerUserId == request.auth.uid");
        expect(familyShareTokenRules).not.toContain("resource.data.get('active', false) == true");
    });

    it('blocks anonymous reads when legacy revocation flags are present', () => {
        expect(familyShareTokenRules).toContain("resource.data.get('revoked', false) != true");
        expect(familyShareTokenRules).toContain("resource.data.get('revokedAt', null) == null");
    });

    it('still reserves revoked-token access for owners and global admins', () => {
        expect(familyShareTokenRules).toContain("isSignedIn() && resource.data.ownerUserId == request.auth.uid");
        expect(familyShareTokenRules).toContain('isGlobalAdmin()');
    });
});
