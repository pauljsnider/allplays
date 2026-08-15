import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(relativePath) {
    return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('player profile cache delivery', () => {
    it('bumps externally loaded entry modules whose Firebase imports changed', () => {
        const entryModules = {
            'admin.html': 'js/admin.js?v=443350',
            'certificates.html': 'js/certificates/studio.js?v=443347',
            'live-game.html': 'js/live-game.js?v=443341',
            'live-tracker.html': 'js/live-tracker.js?v=443321',
            'team-fees.html': 'js/team-fees-admin.js?v=443344',
            'team-media.html': 'js/team-media.js?v=44538',
            'track-basketball.html': 'js/track-basketball.js?v=443320',
            'tracking-items.html': 'js/tracking-items-admin.js?v=443343'
        };

        for (const [pagePath, expectedEntryModule] of Object.entries(entryModules)) {
            expect(read(pagePath)).toContain(expectedEntryModule);
        }
    });

    it('delivers updated shared utility and nested entry-module imports', () => {
        expect(read('js/utils.js')).toContain("import('./global-search.js?v=443337')");
        expect(read('drills.html')).toContain('js/team-admin-banner.js?v=443331');
        expect(read('game-day.html')).toContain('js/team-admin-banner.js?v=443331');
        expect(read('js/certificates/studio.js')).toContain('team-admin-banner.js?v=443331');
        expect(read('team.html')).toContain('js/team-staff-permissions.js?v=443329');
    });
});
