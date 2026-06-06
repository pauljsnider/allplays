import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readParentDashboardSource() {
    return readFileSync(new URL('../../parent-dashboard.html', import.meta.url), 'utf8');
}

describe('parent dashboard loader failure states', () => {
    it('renders a visible fallback when the initial dashboard load fails', () => {
        const source = readParentDashboardSource();

        expect(source).toContain('function renderDashboardLoadFailure(error) {');
        expect(source).toContain("renderPlayers([], { kind: 'load-error', message: error?.message || '' });");
        expect(source).toContain('Schedule data could not be loaded right now.');
        expect(source).toContain('Practice packet data could not be loaded right now.');
        expect(source).toContain('renderDashboardLoadFailure(error);');
    });

    it('distinguishes blocked and stale linked-player states in the player list', () => {
        const source = readParentDashboardSource();

        expect(source).toContain("case 'access-blocked':");
        expect(source).toContain("case 'stale-links':");
        expect(source).toContain('We are holding your saved player links while access finishes syncing.');
        expect(source).toContain('No active linked players were found for this account.');
    });
});
