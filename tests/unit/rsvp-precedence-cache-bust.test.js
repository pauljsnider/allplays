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
            'accept-invite.html': 'db.js?v=4433201',
            'calendar.html': 'db.js?v=4433201',
            'edit-schedule.html': 'db.js?v=4433201',
            'game-day.html': 'db.js?v=4433201',
            'login.html': 'db.js?v=4433201',
            'parent-dashboard.html': 'db.js?v=4433201',
            'team.html': 'db.js?v=4433201',
            'team-chat.html': 'db.js?v=4433201',
            'js/auth.js': 'db.js?v=4433201',
            'profile.html': 'db.js?v=4433201',
            'js/team-media.js': 'db.js?v=4433201'
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
            'scripts/build-help-workflow-html-loop.mjs': 'auth.js?v=4433205',
            'accept-invite.html': 'auth.js?v=4433205',
            'dashboard.html': 'auth.js?v=4433205',
            'edit-team.html': 'auth.js?v=4433205',
            'login.html': 'auth.js?v=4433205',
            'profile.html': 'auth.js?v=4433205',
            'parent-dashboard.html': 'auth.js?v=4433205',
            'js/admin.js': 'auth.js?v=4433205',
            'js/live-game.js': 'auth.js?v=4433205',
            'js/live-tracker.js': 'auth.js?v=4433205',
            'js/team-media.js': 'auth.js?v=4433205',
            'js/utils.js': 'auth.js?v=4433205'
        };

        for (const [path, expectedVersion] of Object.entries(authConsumers)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }
    });

    it('propagates fresh keys through cached wrapper and shared utility entry modules', () => {
        const consumerVersions = {
            'admin.html': 'js/admin.js?v=443364',
            'certificates.html': 'js/certificates/studio.js?v=443371',
            'live-game.html': 'js/live-game.js?v=443367',
            'live-tracker.html': 'js/live-tracker.js?v=443331',
            'team-fees.html': 'js/team-fees-admin.js?v=443367',
            'team-media.html': 'js/team-media.js?v=44547',
            'track-basketball.html': 'js/track-basketball.js?v=443329',
            'tracking-items.html': 'js/tracking-items-admin.js?v=443365',
            'team.html': 'js/team-staff-permissions.js?v=443350',
            'game-day.html': 'js/team-admin-banner.js?v=443352'
        };

        for (const [path, expectedVersion] of Object.entries(consumerVersions)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }

        expect(readRepoFile('js/utils.js')).toContain("import('./global-search.js?v=443358')");
        expect(readRepoFile('js/db.js')).toContain("from './utils.js?v=443377';");
        expect(readRepoFile('parent-dashboard.html')).toContain('js/utils.js?v=443377');
        expect(readRepoFile('js/live-game.js')).toContain("from './live-game-state.js?v=48';");
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
