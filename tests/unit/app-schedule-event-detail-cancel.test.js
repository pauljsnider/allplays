import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readDetailSource() {
    return readFileSync(new URL('../../apps/app/src/pages/ScheduleEventDetail.tsx', import.meta.url), 'utf8');
}

describe('React app schedule event detail cancellation action', () => {
    it('wires a staff-only non-cancelled DB game action through the cancellation service', () => {
        const source = readDetailSource();

        expect(source).toContain('cancelScheduledGameForApp');
        expect(source).toContain("const canCancelGame = Boolean(!isPractice && event.isDbGame && !event.isCancelled && event.canUpdateScore && auth.user);");
        expect(source).toContain('Cancel game');
        expect(source).toContain("const notifiesCounterpartTeam = Boolean(event.opponentTeamId || event.sharedScheduleOpponentTeamId);");
        expect(source).toContain("This marks the game cancelled and notifies ${notifiesCounterpartTeam ? 'both team chats' : 'the team in chat'}.");
        expect(source).toContain("{ ...event, status: 'cancelled', isCancelled: true, availabilityLocked: true }");
        expect(source).toContain('Game cancelled, but team chat notification failed:');
        expect(source).toContain("Game cancelled and both team chats notified.");
        expect(source).toContain("Cancel this game and notify both team chats.");
    });

    it('includes Forecast link logic when a location is present', () => {
        const source = readDetailSource();
        // Check for import of getScheduleForecastHref
        expect(source).toContain('  getScheduleMapHref,');
        expect(source).toContain('  getScheduleForecastHref,'); // New import

        // Check for usage in EventDetailsPanel
        expect(source).toContain('const mapHref = getScheduleMapHref(event.location);');
        expect(source).toContain('const forecastHref = getScheduleForecastHref(event.location);'); // New variable

        // Check for conditional rendering of both links
        expect(source).toContain('{(mapHref || forecastHref) ? ('); // Conditional wrapper
        expect(source).toContain('<a href={mapHref} target="_blank" rel="noreferrer" className="secondary-button min-h-9 flex-1 px-3 py-2 text-xs">'); // Directions link
        expect(source).toContain('Directions');
        expect(source).toContain('<a href={forecastHref} target="_blank" rel="noreferrer" className="secondary-button min-h-9 flex-1 px-3 py-2 text-xs">'); // Forecast link
        expect(source).toContain('Forecast');
    });
});
