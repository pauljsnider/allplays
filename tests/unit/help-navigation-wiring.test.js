import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('help navigation wiring', () => {
    it('links footer help center to help page', () => {
        const utilsJs = readRepoFile('js/utils.js');
        expect(utilsJs).toContain('<li><a href="help.html" class="hover:text-white transition">Help Center</a></li>');
    });

    it('includes help destination in team navigation banner with role context', () => {
        const bannerJs = readRepoFile('js/team-admin-banner.js');
        expect(bannerJs).toContain('help: `help.html?context=team&teamId=${teamId}`');
        expect(bannerJs).toContain("const helpRole = isFullAccess ? 'coach' : 'parent';");
        expect(bannerJs).toContain("label: 'Help'");
    });

    it('renders multi-page help portal links', () => {
        const helpHtml = readRepoFile('help.html');
        expect(helpHtml).toContain('href="help-account.html"');
        expect(helpHtml).toContain('href="help-team-operations.html"');
        expect(helpHtml).toContain('href="help-game-operations.html"');
        expect(helpHtml).toContain('href="help-watch-chat.html"');
        expect(helpHtml).toContain('href="help-page-reference.html"');
    });
});
