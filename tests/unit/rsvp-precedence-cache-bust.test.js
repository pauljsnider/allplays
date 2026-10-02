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
            'accept-invite.html': 'db.js?v=4433200',
            'calendar.html': 'db.js?v=4433200',
            'edit-schedule.html': 'db.js?v=4433200',
            'game-day.html': 'db.js?v=4433200',
            'login.html': 'db.js?v=4433200',
            'parent-dashboard.html': 'db.js?v=4433200',
            'team.html': 'db.js?v=4433200',
            'team-chat.html': 'db.js?v=4433200',
            'js/auth.js': 'db.js?v=4433200',
            'profile.html': 'db.js?v=4433200',
            'js/team-media.js': 'db.js?v=4433200'
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
            'accept-invite.html': 'auth.js?v=4433204',
            'dashboard.html': 'auth.js?v=4433204',
            'edit-team.html': 'auth.js?v=4433204',
            'login.html': 'auth.js?v=4433204',
            'profile.html': 'auth.js?v=4433204',
            'parent-dashboard.html': 'auth.js?v=4433204',
            'js/admin.js': 'auth.js?v=4433204',
            'js/live-game.js': 'auth.js?v=4433204',
            'js/live-tracker.js': 'auth.js?v=4433204',
            'js/team-media.js': 'auth.js?v=4433204',
            'js/utils.js': 'auth.js?v=4433204'
        };

        for (const [path, expectedVersion] of Object.entries(authConsumers)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }
    });

    it('propagates fresh keys through cached wrapper and shared utility entry modules', () => {
        const consumerVersions = {
            'admin.html': 'js/admin.js?v=443363',
            'certificates.html': 'js/certificates/studio.js?v=443370',
            'live-game.html': 'js/live-game.js?v=443362',
            'live-tracker.html': 'js/live-tracker.js?v=443330',
            'team-fees.html': 'js/team-fees-admin.js?v=443366',
            'team-media.html': 'js/team-media.js?v=44546',
            'track-basketball.html': 'js/track-basketball.js?v=443328',
            'tracking-items.html': 'js/tracking-items-admin.js?v=443364',
            'team.html': 'js/team-staff-permissions.js?v=443349',
            'game-day.html': 'js/team-admin-banner.js?v=443351'
        };

        for (const [path, expectedVersion] of Object.entries(consumerVersions)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }

        expect(readRepoFile('js/utils.js')).toContain("import('./global-search.js?v=443357')");
        expect(readRepoFile('js/db.js')).toContain("from './utils.js?v=443376';");
        expect(readRepoFile('parent-dashboard.html')).toContain('js/utils.js?v=443376');
        expect(readRepoFile('js/live-game.js')).toContain("from './live-game-state.js?v=47';");
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
