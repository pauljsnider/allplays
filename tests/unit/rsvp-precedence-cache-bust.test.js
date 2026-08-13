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
            'accept-invite.html': 'db.js?v=4433169',
            'calendar.html': 'db.js?v=4433169',
            'edit-schedule.html': 'db.js?v=4433169',
            'game-day.html': 'db.js?v=4433169',
            'login.html': 'db.js?v=4433169',
            'parent-dashboard.html': 'db.js?v=4433169',
            'team.html': 'db.js?v=4433169',
            'team-chat.html': 'db.js?v=4433169',
            'js/auth.js': 'db.js?v=4433169',
            'profile.html': 'db.js?v=4433169',
            'js/team-media.js': 'db.js?v=4433169'
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
            'accept-invite.html': 'auth.js?v=4433171',
            'dashboard.html': 'auth.js?v=4433171',
            'edit-team.html': 'auth.js?v=4433171',
            'login.html': 'auth.js?v=4433171',
            'profile.html': 'auth.js?v=4433171',
            'parent-dashboard.html': 'auth.js?v=4433171',
            'js/admin.js': 'auth.js?v=4433171',
            'js/live-game.js': 'auth.js?v=4433171',
            'js/live-tracker.js': 'auth.js?v=4433171',
            'js/team-media.js': 'auth.js?v=4433171',
            'js/utils.js': 'auth.js?v=4433171'
        };

        for (const [path, expectedVersion] of Object.entries(authConsumers)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }
    });

    it('propagates fresh keys through cached wrapper and shared utility entry modules', () => {
        const consumerVersions = {
            'admin.html': 'js/admin.js?v=443337',
            'certificates.html': 'js/certificates/studio.js?v=443343',
            'live-game.html': 'js/live-game.js?v=443339',
            'live-tracker.html': 'js/live-tracker.js?v=443320',
            'team-fees.html': 'js/team-fees-admin.js?v=443340',
            'team-media.html': 'js/team-media.js?v=44537',
            'track-basketball.html': 'js/track-basketball.js?v=443319',
            'tracking-items.html': 'js/tracking-items-admin.js?v=443339',
            'team.html': 'js/team-staff-permissions.js?v=443325',
            'game-day.html': 'js/team-admin-banner.js?v=443327'
        };

        for (const [path, expectedVersion] of Object.entries(consumerVersions)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }

        expect(readRepoFile('js/utils.js')).toContain("import('./global-search.js?v=443333')");
        expect(readRepoFile('js/db.js')).toContain("from './utils.js?v=443345';");
        expect(readRepoFile('parent-dashboard.html')).toContain('js/utils.js?v=443345');
        expect(readRepoFile('js/live-game.js')).toContain("from './live-game-state.js?v=22';");
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
