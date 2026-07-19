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
            'accept-invite.html': 'db.js?v=115',
            'calendar.html': 'db.js?v=115',
            'edit-schedule.html': 'db.js?v=115',
            'game-day.html': 'db.js?v=115',
            'login.html': 'db.js?v=115',
            'parent-dashboard.html': 'db.js?v=115',
            'team.html': 'db.js?v=115',
            'team-chat.html': 'db.js?v=115',
            'js/auth.js': 'db.js?v=115',
            'profile.html': 'db.js?v=115',
            'js/team-media.js': 'db.js?v=115'
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
            'accept-invite.html': 'auth.js?v=127',
            'dashboard.html': 'auth.js?v=127',
            'edit-team.html': 'auth.js?v=127',
            'login.html': 'auth.js?v=127',
            'profile.html': 'auth.js?v=127',
            'parent-dashboard.html': 'auth.js?v=127',
            'js/admin.js': 'auth.js?v=127',
            'js/live-game.js': 'auth.js?v=127',
            'js/live-tracker.js': 'auth.js?v=127',
            'js/team-media.js': 'auth.js?v=127',
            'js/utils.js': 'auth.js?v=127'
        };

        for (const [path, expectedVersion] of Object.entries(authConsumers)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }
    });

    it('propagates fresh keys through cached wrapper and shared utility entry modules', () => {
        const consumerVersions = {
            'admin.html': 'js/admin.js?v=18',
            'certificates.html': 'js/certificates/studio.js?v=19',
            'live-game.html': 'js/live-game.js?v=24',
            'live-tracker.html': 'js/live-tracker.js?v=7',
            'team-fees.html': 'js/team-fees-admin.js?v=19',
            'team-media.html': 'js/team-media.js?v=19',
            'track-basketball.html': 'js/track-basketball.js?v=6',
            'tracking-items.html': 'js/tracking-items-admin.js?v=19',
            'team.html': 'js/team-staff-permissions.js?v=6',
            'game-day.html': 'js/team-admin-banner.js?v=8'
        };

        for (const [path, expectedVersion] of Object.entries(consumerVersions)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }

        expect(readRepoFile('js/utils.js')).toContain("import('./global-search.js?v=13')");
        expect(readRepoFile('js/db.js')).toContain("from './utils.js?v=18';");
        expect(readRepoFile('parent-dashboard.html')).toContain('js/utils.js?v=18');
        expect(readRepoFile('js/live-game.js')).toContain("from './live-game-state.js?v=7';");
    });
});
