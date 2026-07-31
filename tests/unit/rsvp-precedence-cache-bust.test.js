import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('RSVP precedence cache delivery', () => {
    it('uses one fresh db module key and versions the indirect staff breakdown graph', () => {
        const dbSource = readRepoFile('js/db.js');
        const breakdownSource = readRepoFile('js/game-day-rsvp-breakdown.js');
        const runtimeSources = {
            'accept-invite.html': 'db.js?v=129',
            'calendar.html': 'db.js?v=129',
            'edit-schedule.html': 'db.js?v=129',
            'game-day.html': 'db.js?v=129',
            'login.html': 'db.js?v=129',
            'parent-dashboard.html': 'db.js?v=132',
            'team.html': 'db.js?v=129',
            'team-chat.html': 'db.js?v=129',
            'js/auth.js': 'db.js?v=129',
            'profile.html': 'db.js?v=129',
            'js/team-media.js': 'db.js?v=129'
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
            'accept-invite.html': 'auth.js?v=137',
            'dashboard.html': 'auth.js?v=137',
            'edit-team.html': 'auth.js?v=137',
            'login.html': 'auth.js?v=137',
            'profile.html': 'auth.js?v=137',
            'parent-dashboard.html': 'auth.js?v=137',
            'js/admin.js': 'auth.js?v=137',
            'js/live-game.js': 'auth.js?v=137',
            'js/live-tracker.js': 'auth.js?v=137',
            'js/team-media.js': 'auth.js?v=137',
            'js/utils.js': 'auth.js?v=137'
        };

        for (const [path, expectedVersion] of Object.entries(authConsumers)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }
    });

    it('propagates fresh keys through cached wrapper and shared utility entry modules', () => {
        const consumerVersions = {
            'admin.html': 'js/admin.js?v=25',
            'certificates.html': 'js/certificates/studio.js?v=21',
            'live-game.html': 'js/live-game.js?v=26',
            'live-tracker.html': 'js/live-tracker.js?v=9',
            'team-fees.html': 'js/team-fees-admin.js?v=22',
            'team-media.html': 'js/team-media.js?v=21',
            'track-basketball.html': 'js/track-basketball.js?v=8',
            'tracking-items.html': 'js/tracking-items-admin.js?v=21',
            'team.html': 'js/team-staff-permissions.js?v=8',
            'game-day.html': 'js/team-admin-banner.js?v=10'
        };

        for (const [path, expectedVersion] of Object.entries(consumerVersions)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }

        expect(readRepoFile('js/utils.js')).toContain("import('./global-search.js?v=15')");
        expect(readRepoFile('js/db.js')).toContain("from './utils.js?v=20';");
        expect(readRepoFile('parent-dashboard.html')).toContain('js/utils.js?v=20');
        expect(readRepoFile('js/live-game.js')).toContain("from './live-game-state.js?v=7';");
    });
});
