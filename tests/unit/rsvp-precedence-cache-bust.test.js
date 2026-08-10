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
            'accept-invite.html': 'db.js?v=4433163',
            'calendar.html': 'db.js?v=4433163',
            'edit-schedule.html': 'db.js?v=4433163',
            'game-day.html': 'db.js?v=4433163',
            'login.html': 'db.js?v=4433163',
            'parent-dashboard.html': 'db.js?v=4433163',
            'team.html': 'db.js?v=4433163',
            'team-chat.html': 'db.js?v=4433163',
            'js/auth.js': 'db.js?v=4433163',
            'profile.html': 'db.js?v=4433163',
            'js/team-media.js': 'db.js?v=4433163'
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
            'accept-invite.html': 'auth.js?v=4433165',
            'dashboard.html': 'auth.js?v=4433165',
            'edit-team.html': 'auth.js?v=4433165',
            'login.html': 'auth.js?v=4433165',
            'profile.html': 'auth.js?v=4433165',
            'parent-dashboard.html': 'auth.js?v=4433165',
            'js/admin.js': 'auth.js?v=4433165',
            'js/live-game.js': 'auth.js?v=4433165',
            'js/live-tracker.js': 'auth.js?v=4433165',
            'js/team-media.js': 'auth.js?v=4433165',
            'js/utils.js': 'auth.js?v=4433165'
        };

        for (const [path, expectedVersion] of Object.entries(authConsumers)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }
    });

    it('propagates fresh keys through cached wrapper and shared utility entry modules', () => {
        const consumerVersions = {
            'admin.html': 'js/admin.js?v=443332',
            'certificates.html': 'js/certificates/studio.js?v=443336',
            'live-game.html': 'js/live-game.js?v=443334',
            'live-tracker.html': 'js/live-tracker.js?v=443314',
            'team-fees.html': 'js/team-fees-admin.js?v=443334',
            'team-media.html': 'js/team-media.js?v=44532',
            'track-basketball.html': 'js/track-basketball.js?v=443313',
            'tracking-items.html': 'js/tracking-items-admin.js?v=443333',
            'team.html': 'js/team-staff-permissions.js?v=443319',
            'game-day.html': 'js/team-admin-banner.js?v=443321'
        };

        for (const [path, expectedVersion] of Object.entries(consumerVersions)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }

        expect(readRepoFile('js/utils.js')).toContain("import('./global-search.js?v=443327')");
        expect(readRepoFile('js/db.js')).toContain("from './utils.js?v=443339';");
        expect(readRepoFile('parent-dashboard.html')).toContain('js/utils.js?v=443339');
        expect(readRepoFile('js/live-game.js')).toContain("from './live-game-state.js?v=16';");
    });

    it('guards the shared utils cache key and all of its production consumers', () => {
        const guard = readRepoFile('scripts/check-critical-cache-bust.mjs');

        expect(guard).toContain("changedFile: 'js/utils.js'");
        expect(guard).toContain('js/utils.js changed but production consumers do not share one cache version.');
        expect(guard).toContain('js/utils.js changed without increasing the shared production utils.js cache version.');
        expect(guard).toContain("execGit(['show', `${ref}:${file}`])");
        expect(guard).toContain("execGit(['merge-base', diffBase.split('...')[0], 'HEAD'])");
        expect(guard).not.toContain("diffText.matchAll(/^\\+(?!\\+\\+\\+).*\\/utils\\.js");
    });
});
