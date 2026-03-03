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

    it('includes help destination in team navigation banner', () => {
        const bannerJs = readRepoFile('js/team-admin-banner.js');
        expect(bannerJs).toContain('help: `help.html?context=team&teamId=${teamId}`');
        expect(bannerJs).toContain("label: 'Help'");
    });
});
