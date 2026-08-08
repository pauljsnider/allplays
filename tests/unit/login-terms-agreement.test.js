import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const loginHtml = readFileSync(fileURLToPath(new URL('../../login.html', import.meta.url)), 'utf8');

describe('legacy signup terms agreement', () => {
    it('includes a terms agreement checkbox linking to the public policies', () => {
        expect(loginHtml).toContain('id="terms-agree-field"');
        expect(loginHtml).toContain('id="terms-agree"');
        expect(loginHtml).toContain('type="checkbox"');
        expect(loginHtml).toContain('href="/terms.html"');
        expect(loginHtml).toContain('href="/privacy.html"');
    });

    it('hides the checkbox by default so it only shows in signup mode', () => {
        expect(loginHtml).toMatch(/id="terms-agree-field"\s+class="hidden"/);
    });

    it('shows the checkbox when entering signup mode and hides it in login mode', () => {
        // showSignupMode reveals the field
        expect(loginHtml).toContain("document.getElementById('terms-agree-field').classList.remove('hidden')");
        // login branch hides it and resets the checkbox
        expect(loginHtml).toContain("termsAgreeField.classList.add('hidden')");
        expect(loginHtml).toContain('termsAgreeInput.checked = false');
    });

    it('blocks email and Google signup until the box is checked', () => {
        const guards = loginHtml.match(/if \(!document\.getElementById\('terms-agree'\)\.checked\) \{/g) || [];
        expect(guards.length).toBe(2);
        expect(loginHtml).toContain('Please agree to the Terms and Privacy Policy to continue.');
    });
});
