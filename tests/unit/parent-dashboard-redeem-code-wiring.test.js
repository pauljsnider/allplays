import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('parent dashboard redeem code wiring', () => {
    it('redeems parent invite codes directly through the duplicate-aware helper', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toMatch(/document\.getElementById\('redeem-code-btn'\)\.addEventListener\('click', async \(\) => \{[\s\S]*await redeemParentInvite\(user\.uid, code\);/);
        expect(html).not.toMatch(/document\.getElementById\('redeem-code-btn'\)\.addEventListener\('click', async \(\) => \{[\s\S]*validateAccessCode\(code\)/);
    });
});
