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
            'accept-invite.html': 'db.js?v=108',
            'calendar.html': 'db.js?v=108',
            'edit-schedule.html': 'db.js?v=108',
            'game-day.html': 'db.js?v=108',
            'login.html': 'db.js?v=108',
            'parent-dashboard.html': 'db.js?v=108',
            'team.html': 'db.js?v=108',
            'team-chat.html': 'db.js?v=108',
            'js/auth.js': 'db.js?v=108',
            'profile.html': 'db.js?v=108',
            'js/team-media.js': 'db.js?v=108'
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
            'accept-invite.html': 'auth.js?v=52',
            'dashboard.html': 'auth.js?v=52',
            'edit-team.html': 'auth.js?v=52',
            'login.html': 'auth.js?v=52',
            'profile.html': 'auth.js?v=52',
            'parent-dashboard.html': 'auth.js?v=52',
            'js/admin.js': 'auth.js?v=52',
            'js/live-game.js': 'auth.js?v=52',
            'js/live-tracker.js': 'auth.js?v=52',
            'js/team-media.js': 'auth.js?v=52',
            'js/utils.js': 'auth.js?v=52'
        };

        for (const [path, expectedVersion] of Object.entries(authConsumers)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }
    });

    it('propagates fresh keys through cached wrapper and shared utility entry modules', () => {
        const consumerVersions = {
            'admin.html': 'js/admin.js?v=11',
            'certificates.html': 'js/certificates/studio.js?v=16',
            'live-game.html': 'js/live-game.js?v=21',
            'live-tracker.html': 'js/live-tracker.js?v=4',
            'team-fees.html': 'js/team-fees-admin.js?v=15',
            'team-media.html': 'js/team-media.js?v=16',
            'track-basketball.html': 'js/track-basketball.js?v=3',
            'tracking-items.html': 'js/tracking-items-admin.js?v=3',
            'team.html': 'js/team-staff-permissions.js?v=4',
            'game-day.html': 'js/team-admin-banner.js?v=6'
        };

        for (const [path, expectedVersion] of Object.entries(consumerVersions)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }

        expect(readRepoFile('js/utils.js')).toContain("import('./global-search.js?v=10')");
        expect(readRepoFile('js/db.js')).toContain("from './utils.js?v=16';");
        expect(readRepoFile('parent-dashboard.html')).toContain('js/utils.js?v=16');
        expect(readRepoFile('js/live-game.js')).toContain("from './live-game-state.js?v=7';");
    });
});
