import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveSummaryRecipient } from '../../js/live-tracker-email.js';

describe('legacy tracker summary email recipient', () => {
    it('prefers team notification email over signed-in user email', () => {
        expect(resolveSummaryRecipient({
            teamNotificationEmail: 'team-notify@example.com',
            userEmail: 'coach-login@example.com'
        })).toBe('team-notify@example.com');
    });

    it('falls back to signed-in user email when team notification email is blank', () => {
        expect(resolveSummaryRecipient({
            teamNotificationEmail: '   ',
            userEmail: 'coach-login@example.com'
        })).toBe('coach-login@example.com');
    });

    it('wires recipient resolution into track.html summary email flows', () => {
        const source = readFileSync(new URL('../../track.html', import.meta.url), 'utf8');
        expect(source).toContain('resolveSummaryRecipient');
        expect(source).toContain('teamNotificationEmail: currentTeam?.notificationEmail');
    });

    it('wires recipient resolution into the beta basketball tracker finish flow', () => {
        const source = readFileSync(new URL('../../js/track-basketball.js', import.meta.url), 'utf8');
        expect(source).toContain('resolveSummaryRecipient');
        expect(source).toContain('resolveFinalScore');
        expect(source).toContain('teamNotificationEmail: currentTeam?.notificationEmail');
    });
});
