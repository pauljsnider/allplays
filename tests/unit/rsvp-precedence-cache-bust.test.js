import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('RSVP precedence cache delivery', () => {
    it('uses the public-boundary db module key and versions the indirect staff breakdown graph', () => {
        const dbSource = readRepoFile('js/db.js');
        const breakdownSource = readRepoFile('js/game-day-rsvp-breakdown.js');
        const runtimeSources = {
            'accept-invite.html': 'db.js?v=135',
            'calendar.html': 'db.js?v=135',
            'edit-schedule.html': 'db.js?v=135',
            'game-day.html': 'db.js?v=135',
            'login.html': 'db.js?v=135',
            'parent-dashboard.html': 'db.js?v=135',
            'team.html': 'db.js?v=135',
            'team-chat.html': 'db.js?v=135',
            'js/auth.js': 'db.js?v=135',
            'profile.html': 'db.js?v=135',
            'js/team-media.js': 'db.js?v=135'
        };

        for (const [path, expectedVersion] of Object.entries(runtimeSources)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }
        expect(dbSource).toContain("from './rsvp-summary.js?v=2';");
        expect(dbSource).toContain("from './game-day-rsvp-breakdown.js?v=3';");
        expect(breakdownSource).toContain("from './rsvp-summary.js?v=2';");
    });

    it('versions every deployed auth consumer after auth adopts the fresh db key', () => {
        const authConsumers = {
            'accept-invite.html': 'auth.js?v=139',
            'dashboard.html': 'auth.js?v=139',
            'edit-team.html': 'auth.js?v=139',
            'login.html': 'auth.js?v=139',
            'profile.html': 'auth.js?v=139',
            'parent-dashboard.html': 'auth.js?v=139',
            'js/admin.js': 'auth.js?v=139',
            'js/live-game.js': 'auth.js?v=139',
            'js/live-tracker.js': 'auth.js?v=139',
            'js/team-media.js': 'auth.js?v=139',
            'js/utils.js': 'auth.js?v=139'
        };

        for (const [path, expectedVersion] of Object.entries(authConsumers)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }
    });

    it('propagates fresh keys through cached wrapper and shared utility entry modules', () => {
        const consumerVersions = {
            'admin.html': 'js/admin.js?v=26',
            'certificates.html': 'js/certificates/studio.js?v=22',
            'live-game.html': 'js/live-game.js?v=27',
            'live-tracker.html': 'js/live-tracker.js?v=10',
            'team-fees.html': 'js/team-fees-admin.js?v=23',
            'team-media.html': 'js/team-media.js?v=22',
            'track-basketball.html': 'js/track-basketball.js?v=9',
            'tracking-items.html': 'js/tracking-items-admin.js?v=22',
            'team.html': 'js/team-staff-permissions.js?v=9',
            'game-day.html': 'js/team-admin-banner.js?v=11'
        };

        for (const [path, expectedVersion] of Object.entries(consumerVersions)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }

        expect(readRepoFile('js/utils.js')).toContain("import('./global-search.js?v=16')");
        expect(readRepoFile('js/db.js')).toContain("from './utils.js?v=21';");
        expect(readRepoFile('parent-dashboard.html')).toContain('js/utils.js?v=21');
        expect(readRepoFile('js/live-game.js')).toContain("from './live-game-state.js?v=7';");
    });
});
