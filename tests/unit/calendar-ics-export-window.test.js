import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readCalendarPage() {
    return readFileSync(new URL('../../calendar.html', import.meta.url), 'utf8');
}

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}`);
    if (start === -1) {
        throw new Error(`Function ${name} not found`);
    }

    const bodyStart = source.indexOf('{', start);
    let depth = 0;

    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }

    throw new Error(`Function ${name} did not terminate`);
}

function createCalendarHooks() {
    const source = readCalendarPage();
    const getCalendarViewEventsSource = extractFunction(source, 'getCalendarViewEvents');
    const getVisibleExportEventsSource = extractFunction(source, 'getVisibleExportEvents');

    return new Function(`
let allEvents = [];
let filteredEvents = [];
let currentView = 'detailed';
let currentTypeFilter = 'all';
let currentTeamFilter = '';
let calendarMonth = 0;
let calendarYear = 2026;
${getCalendarViewEventsSource}
${getVisibleExportEventsSource}
return {
    setState(nextState) {
        allEvents = nextState.allEvents ?? allEvents;
        filteredEvents = nextState.filteredEvents ?? filteredEvents;
        currentView = nextState.currentView ?? currentView;
        currentTypeFilter = nextState.currentTypeFilter ?? currentTypeFilter;
        currentTeamFilter = nextState.currentTeamFilter ?? currentTeamFilter;
        calendarMonth = nextState.calendarMonth ?? calendarMonth;
        calendarYear = nextState.calendarYear ?? calendarYear;
    },
    getVisibleExportEvents
};
`)();
}

describe('calendar ICS export window', () => {
    it('exports only the visible month events in calendar view while preserving active filters', () => {
        const hooks = createCalendarHooks();
        const juneEvent = {
            id: 'june-practice',
            teamId: 'team-1',
            type: 'practice',
            date: new Date('2026-06-15T18:00:00Z')
        };
        const julyEvent = {
            id: 'july-practice',
            teamId: 'team-1',
            type: 'practice',
            date: new Date('2026-07-02T18:00:00Z')
        };
        const otherTeamJuneEvent = {
            id: 'other-team-june-practice',
            teamId: 'team-2',
            type: 'practice',
            date: new Date('2026-06-20T18:00:00Z')
        };

        hooks.setState({
            allEvents: [juneEvent, julyEvent, otherTeamJuneEvent],
            filteredEvents: [juneEvent, julyEvent, otherTeamJuneEvent],
            currentView: 'calendar',
            currentTypeFilter: 'practice',
            currentTeamFilter: 'team-1',
            calendarMonth: 5,
            calendarYear: 2026
        });

        expect(hooks.getVisibleExportEvents()).toEqual([juneEvent]);
    });

    it('keeps non-calendar exports tied to the filtered event set', () => {
        const hooks = createCalendarHooks();
        const filteredEvent = {
            id: 'filtered-game',
            teamId: 'team-1',
            type: 'game',
            date: new Date('2026-06-10T18:00:00Z')
        };
        const nonFilteredEvent = {
            id: 'non-filtered-game',
            teamId: 'team-1',
            type: 'game',
            date: new Date('2026-07-10T18:00:00Z')
        };

        hooks.setState({
            allEvents: [filteredEvent, nonFilteredEvent],
            filteredEvents: [filteredEvent],
            currentView: 'detailed',
            calendarMonth: 6,
            calendarYear: 2026
        });

        expect(hooks.getVisibleExportEvents()).toEqual([filteredEvent]);
    });

    it('wires exportIcs through the visible export event selector', () => {
        const source = readCalendarPage();

        expect(source).toContain('const exportEvents = getVisibleExportEvents();');
        expect(source).toContain('exportEvents.forEach(ev => {');
    });
});
