import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readAppPage(name) {
    return readFileSync(new URL(`../../apps/app/src/pages/${name}.tsx`, import.meta.url), 'utf8');
}

describe('primary-route resume refresh contracts', () => {
    it('returns each route refresh promise to the warm-resume timer', () => {
        const home = readAppPage('Home');
        const schedule = readAppPage('Schedule');
        const messages = readAppPage('Messages');

        expect(home).toContain('useRefreshOnResume(() => refreshHome({ force: true })');
        expect(home).toContain('secondaryLoadPromise = runSecondaryLoad(');
        expect(home).toContain('await secondaryLoadPromise;');
        expect(schedule).toContain('useRefreshOnResume(() => refreshSchedule(true)');
        expect(messages).toContain('() => shouldLoadInbox ? refreshInbox() : undefined');

        expect(home).not.toContain('useRefreshOnResume(() => { void refreshHome');
        expect(schedule).not.toContain('useRefreshOnResume(() => { void refreshSchedule');
        expect(messages).not.toContain('if (shouldLoadInbox) void refreshInbox()');
    });

    it('cancels superseded inbox timers on both success and error paths', () => {
        const messages = readAppPage('Messages');
        const staleRequestGuards = messages.match(/timer\.cancel\(\{ reason: 'superseded' \}\);/g) || [];

        expect(staleRequestGuards).toHaveLength(2);
    });
});
