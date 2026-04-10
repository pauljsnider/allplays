import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('help navigation wiring', () => {
    it('links footer help center to help page', () => {
        const utilsJs = readRepoFile('js/utils.js');
        expect(utilsJs).toContain('<li><a href="help.html" class="hover:text-white transition">Help Center</a></li>');
        expect(utilsJs).toContain('mailto:paul@paulsnider.net?subject=ALL%20PLAYS%20Support');
    });

    it('keeps homepage footer support links aligned with the shared footer contract', () => {
        const indexHtml = readRepoFile('index.html');
        expect(indexHtml).toContain('<li><a href="help.html" class="hover:text-white transition">Help Center</a></li>');
        expect(indexHtml).toContain('mailto:paul@paulsnider.net?subject=ALL%20PLAYS%20Support');
    });

    it('includes help destination in team navigation banner with role context', () => {
        const bannerJs = readRepoFile('js/team-admin-banner.js');
        expect(bannerJs).toContain('help: `help.html?context=team&teamId=${teamId}`');
        expect(bannerJs).toContain("const helpRole = isFullAccess ? 'coach' : 'parent';");
        expect(bannerJs).toContain("label: 'Help'");
    });

    it('renders multi-page help portal links', () => {
        const helpHtml = readRepoFile('help.html');
        expect(helpHtml).toContain('href="workflow-getting-started.html"');
        expect(helpHtml).toContain('href="workflow-team-setup.html"');
        expect(helpHtml).toContain('href="workflow-game-day.html"');
        expect(helpHtml).toContain('href="workflow-live-watch-replay.html"');
        expect(helpHtml).toContain('href="workflow-track-game.html"');
    });
});
