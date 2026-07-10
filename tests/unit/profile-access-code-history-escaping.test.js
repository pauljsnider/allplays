import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readProfilePage() {
    return readFileSync(new URL('../../profile.html', import.meta.url), 'utf8');
}

describe('profile access code history escaping', () => {
    it('escapes stored invite contact fields before rendering history with innerHTML', () => {
        const source = readProfilePage();

        expect(source).toContain("import { renderHeader, renderFooter, escapeHtml } from './js/utils.js?v=15';");
        expect(source).toContain('const escapedEmail = escapeHtml(code.email);');
        expect(source).toContain('const escapedPhone = escapeHtml(code.phone);');
        expect(source).toContain('<span class="font-medium break-all">${escapedEmail}</span>');
        expect(source).toContain('<span class="font-medium">${escapedPhone}</span>');
        expect(source).not.toContain('<span class="font-medium break-all">${code.email}</span>');
        expect(source).not.toContain('<span class="font-medium">${code.phone}</span>');
    });
});
