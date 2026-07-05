import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readDetailSource() {
    return readFileSync(new URL('../../apps/app/src/pages/ScheduleEventDetail.tsx', import.meta.url), 'utf8');
}

function readDetailsPanelSource() {
    return readFileSync(new URL('../../apps/app/src/components/schedule/EventDetailsPanel.tsx', import.meta.url), 'utf8');
}

describe('React app schedule event detail cancellation action', () => {
    it('wires a staff-only non-cancelled DB game action through the cancellation service', () => {
        const source = readDetailSource();

        expect(source).toContain('cancelScheduledGameForApp');
        expect(source).toContain("const canCancelGame = Boolean(!isPractice && event.isDbGame && !event.isCancelled && event.canUpdateScore && auth.user);");
        expect(source).toContain('Cancel game');
        expect(source).toContain("const notifiesCounterpartTeam = Boolean(event.opponentTeamId || event.sharedScheduleOpponentTeamId);");
        expect(source).toContain("This marks the game cancelled and notifies ${notifiesCounterpartTeam ? 'both team chats' : 'the team in chat'}.`);");
        expect(source).toContain("{ ...event, status: 'cancelled', isCancelled: true, availabilityLocked: true }");
        expect(source).toContain('Game cancelled, but team chat notification failed:');
        expect(source).toContain('Game cancelled and both team chats notified.');
        expect(source).toContain('Cancel this game and notify both team chats.');
    });

    it('adds recurring practice occurrence cancellation for staff-only schedule detail views', () => {
        const source = readDetailSource();

        expect(source).toContain('cancelPracticeOccurrenceForApp');
        expect(source).toContain("const isRecurringPracticeOccurrence = Boolean(isPractice && event.id.includes('__'));");
        expect(source).toContain("const canCancelPracticeOccurrence = Boolean(isRecurringPracticeOccurrence && event.isDbGame && !event.isCancelled && event.isTeamAdmin && auth.user);");
        expect(source).toContain("Cancel only ${practiceLabel} on ${formatEventDateLabel(event.date)}? This cancels just this occurrence, not the full recurring series.`);");
        expect(source).toContain('Practice occurrence cancelled for this date only.');
        expect(source).toContain('Cancel this occurrence');
        expect(source).toContain('Cancel only this recurring practice occurrence.');
    });

    it('includes Forecast link logic when a location is present', () => {
        const pageSource = readDetailSource();
        const panelSource = readDetailsPanelSource();

        expect(pageSource).toContain("import { EventDetailsPanel } from '../components/schedule/EventDetailsPanel';");
        expect(panelSource).toContain('  getScheduleMapHref,');
        expect(panelSource).toContain('  getScheduleForecastHref,');
        expect(panelSource).toContain('const mapHref = getScheduleMapHref(event.location);');
        expect(panelSource).toContain('const forecastHref = getScheduleForecastHref(event.location);');
        expect(panelSource).toContain('{(mapHref || forecastHref) ? (');
        expect(panelSource).toContain('<a href={mapHref} target="_blank" rel="noreferrer" className="secondary-button min-h-9 flex-1 px-3 py-2 text-xs">');
        expect(panelSource).toContain('Directions');
        expect(panelSource).toContain('<a href={forecastHref} target="_blank" rel="noreferrer" className="secondary-button min-h-9 flex-1 px-3 py-2 text-xs">');
        expect(panelSource).toContain('Forecast');
    });
});
