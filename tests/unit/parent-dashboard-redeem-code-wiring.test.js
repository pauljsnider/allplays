import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('parent dashboard redeem code wiring', () => {
    it('routes entered codes through the shared accept-invite flow', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toMatch(/document\.getElementById\('redeem-code-btn'\)\.addEventListener\('click', \(\) => \{[\s\S]*location\.assign\(`\/app\/#\/accept-invite\?code=\$\{encodeURIComponent\(code\)\}`\);/);
        expect(html).not.toContain('redeemParentInvite');
    });
});
