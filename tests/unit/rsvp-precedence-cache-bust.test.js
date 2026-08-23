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
            'accept-invite.html': 'db.js?v=4433188',
            'calendar.html': 'db.js?v=4433188',
            'edit-schedule.html': 'db.js?v=4433188',
            'game-day.html': 'db.js?v=4433188',
            'login.html': 'db.js?v=4433188',
            'parent-dashboard.html': 'db.js?v=4433188',
            'team.html': 'db.js?v=4433188',
            'team-chat.html': 'db.js?v=4433188',
            'js/auth.js': 'db.js?v=4433188',
            'profile.html': 'db.js?v=4433188',
            'js/team-media.js': 'db.js?v=4433188'
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
            'accept-invite.html': 'auth.js?v=4433192',
            'dashboard.html': 'auth.js?v=4433192',
            'edit-team.html': 'auth.js?v=4433192',
            'login.html': 'auth.js?v=4433192',
            'profile.html': 'auth.js?v=4433192',
            'parent-dashboard.html': 'auth.js?v=4433192',
            'js/admin.js': 'auth.js?v=4433192',
            'js/live-game.js': 'auth.js?v=4433192',
            'js/live-tracker.js': 'auth.js?v=4433192',
            'js/team-media.js': 'auth.js?v=4433192',
            'js/utils.js': 'auth.js?v=4433192'
        };

        for (const [path, expectedVersion] of Object.entries(authConsumers)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }
    });

    it('propagates fresh keys through cached wrapper and shared utility entry modules', () => {
        const consumerVersions = {
            'admin.html': 'js/admin.js?v=443355',
            'certificates.html': 'js/certificates/studio.js?v=443357',
            'live-game.html': 'js/live-game.js?v=443345',
            'live-tracker.html': 'js/live-tracker.js?v=443324',
            'team-fees.html': 'js/team-fees-admin.js?v=443355',
            'team-media.html': 'js/team-media.js?v=44541',
            'track-basketball.html': 'js/track-basketball.js?v=443323',
            'tracking-items.html': 'js/tracking-items-admin.js?v=443353',
            'team.html': 'js/team-staff-permissions.js?v=443338',
            'game-day.html': 'js/team-admin-banner.js?v=443340'
        };

        for (const [path, expectedVersion] of Object.entries(consumerVersions)) {
            expect(readRepoFile(path)).toContain(expectedVersion);
        }

        expect(readRepoFile('js/utils.js')).toContain("import('./global-search.js?v=443346')");
        expect(readRepoFile('js/db.js')).toContain("from './utils.js?v=443364';");
        expect(readRepoFile('parent-dashboard.html')).toContain('js/utils.js?v=443364');
        expect(readRepoFile('js/live-game.js')).toContain("from './live-game-state.js?v=36';");
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
