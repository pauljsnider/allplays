import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('parent dashboard redeem code wiring', () => {
    it('validates parent invite codes before attempting manual redemption', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain('validateAccessCode');
        expect(html).toMatch(/document\.getElementById\('redeem-code-btn'\)\.addEventListener\('click', async \(\) => \{[\s\S]*const validation = await validateAccessCode\(code\);[\s\S]*if \(!validation\.valid\) \{[\s\S]*throw new Error\(validation\.message \|\| 'Invalid or expired code'\);[\s\S]*\}[\s\S]*await redeemParentInvite\(user\.uid, code\);/);
    });
});
