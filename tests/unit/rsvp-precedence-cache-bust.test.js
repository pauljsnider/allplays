import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('RSVP precedence cache delivery', () => {
    it('uses one fresh db module key and versions the indirect staff breakdown graph', () => {
        const dbSource = readRepoFile('js/db.js');
        const breakdownSource = readRepoFile('js/game-day-rsvp-breakdown.js');
        const runtimeSources = [
            'accept-invite.html',
            'calendar.html',
            'edit-schedule.html',
            'game-day.html',
            'login.html',
            'parent-dashboard.html',
            'team.html',
            'team-chat.html',
            'js/auth.js',
            'js/team-media.js'
        ].map(readRepoFile);

        runtimeSources.forEach((source) => {
            expect(source).toContain('db.js?v=91');
        });
        expect(dbSource).toContain("from './rsvp-summary.js?v=2';");
        expect(dbSource).toContain("from './game-day-rsvp-breakdown.js?v=2';");
        expect(breakdownSource).toContain("from './rsvp-summary.js?v=2';");
    });

    it('versions every deployed auth consumer after auth adopts the fresh db key', () => {
        const authConsumers = [
            'accept-invite.html',
            'dashboard.html',
            'edit-team.html',
            'login.html',
            'parent-dashboard.html',
            'js/admin.js',
            'js/live-game.js',
            'js/live-tracker.js',
            'js/team-media.js',
            'js/utils.js'
        ].map(readRepoFile);

        authConsumers.forEach((source) => {
            expect(source).toContain('auth.js?v=46');
        });
    });
});
