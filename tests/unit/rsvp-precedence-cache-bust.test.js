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
            'accept-invite.html': 'db.js?v=4433217',
            'calendar.html': 'db.js?v=4433217',
            'edit-schedule.html': 'db.js?v=4433217',
            'game-day.html': 'db.js?v=4433217',
            'login.html': 'db.js?v=4433217',
            'parent-dashboard.html': 'db.js?v=4433217',
            'team.html': 'db.js?v=4433217',
            'team-chat.html': 'db.js?v=4433217',
            'js/auth.js': 'db.js?v=4433217',
            'profile.html': 'db.js?v=4433217',
            'js/team-media.js': 'db.js?v=4433217'
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
            'scripts/build-help-workflow-html-loop.mjs': 'auth.js?v=4433222',
            'accept-invite.html': 'auth.js?v=4433222',
            'dashboard.html': 'auth.js?v=4433222',
            'edit-team.html': 'auth.js?v=4433222',
            'login.html': 'auth.js?v=4433222',
            'profile.html': 'auth.js?v=4433222',
            'parent-dashboard.html': 'auth.js?v=4433222',
            'js/admin.js': 'auth.js?v=4433222',
            'js/live-game.js': 'auth.js?v=4433222',
            'js/live-tracker.js': 'auth.js?v=4433222',
            'js/team-media.js': 'auth.js?v=4433222',
            'js/utils.js': 'auth.js?v=4433222'
        };

        for (const [path, expectedVersion] of Object.entries(authConsumers)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }
    });

    it('propagates fresh keys through cached wrapper and shared utility entry modules', () => {
        const consumerVersions = {
            'admin.html': 'js/admin.js?v=443370',
            'certificates.html': 'js/certificates/studio.js?v=443387',
            'live-game.html': 'js/live-game.js?v=443384',
            'live-tracker.html': 'js/live-tracker.js?v=443342',
            'team-fees.html': 'js/team-fees-admin.js?v=443383',
            'team-media.html': 'js/team-media.js?v=44552',
            'track-basketball.html': 'js/track-basketball.js?v=443338',
            'tracking-items.html': 'js/tracking-items-admin.js?v=443381',
            'team.html': 'js/team-staff-permissions.js?v=443366',
            'game-day.html': 'js/team-admin-banner.js?v=443368'
        };

        for (const [path, expectedVersion] of Object.entries(consumerVersions)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }

        expect(readRepoFile('js/utils.js')).toContain("import('./global-search.js?v=443374')");
        expect(readRepoFile('js/db.js')).toContain("from './utils.js?v=443393';");
        expect(readRepoFile('parent-dashboard.html')).toContain('js/utils.js?v=443393');
        expect(readRepoFile('js/live-game.js')).toContain("from './live-game-state.js?v=65';");
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
