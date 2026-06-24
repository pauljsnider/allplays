import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readTeamPageSource() {
    return readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
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

function createTeamIcsHooks() {
    const source = readTeamPageSource();
    const formatIcsDateSource = extractFunction(source, 'formatIcsDate');
    const escapeIcsTextSource = extractFunction(source, 'escapeIcsText');
    const getIcsEventSummarySource = extractFunction(source, 'getIcsEventSummary');
    const resolveIcsEventEndDateSource = extractFunction(source, 'resolveIcsEventEndDate');
    const buildIcsSource = extractFunction(source, 'buildIcs');

    return new Function(`
let currentTeam = { name: 'Wildcats' };
let currentTeamId = 'team-1';
${formatIcsDateSource}
${escapeIcsTextSource}
${getIcsEventSummarySource}
${resolveIcsEventEndDateSource}
${buildIcsSource}
return { buildIcs, getIcsEventSummary, escapeIcsText, resolveIcsEventEndDate };
`)();
}

describe('team ICS export', () => {
    it('preserves practice titles instead of exporting practice events as games', () => {
        const { buildIcs, getIcsEventSummary } = createTeamIcsHooks();
        const ics = buildIcs([
            {
                id: 'practice-1',
                type: 'practice',
                title: 'Pitching practice',
                opponent: null,
                date: new Date('2026-06-10T18:00:00Z'),
                location: 'Main Field',
                status: 'scheduled'
            },
            {
                id: 'game-1',
                type: 'game',
                opponent: 'Lions',
                date: new Date('2026-06-11T18:00:00Z'),
                location: 'North Field',
                status: 'scheduled'
            }
        ]);

        expect(getIcsEventSummary({ type: 'practice', title: 'Pitching practice' }, 'Wildcats')).toBe('Pitching practice');
        expect(getIcsEventSummary({ type: 'practice', title: '   ' }, 'Wildcats')).toBe('Practice');
        expect(ics).toContain('SUMMARY:Pitching practice');
        expect(ics).not.toContain('SUMMARY:Wildcats vs TBD');
        expect(ics).toContain('SUMMARY:Wildcats vs Lions');
    });

    it('escapes ICS control characters in practice titles', () => {
        const { buildIcs, escapeIcsText } = createTeamIcsHooks();
        const title = 'Pitching\\Practice;Plan, A\nLOCATION:Injected';
        const ics = buildIcs([
            {
                id: 'practice-2',
                type: 'practice',
                title,
                opponent: null,
                date: new Date('2026-06-12T18:00:00Z'),
                location: 'Main Field',
                status: 'scheduled'
            }
        ]);

        expect(escapeIcsText(title)).toBe('Pitching\\\\Practice\\;Plan\\, A\\nLOCATION:Injected');
        expect(ics).toContain('SUMMARY:Pitching\\\\Practice\\;Plan\\, A\\nLOCATION:Injected');
        expect(ics).not.toContain('\r\nLOCATION:Injected\r\nLOCATION:Main Field');
    });

    it('uses saved end times when exporting events', () => {
        const { buildIcs } = createTeamIcsHooks();
        const ics = buildIcs([
            {
                id: 'practice-3',
                type: 'practice',
                title: 'Evening practice',
                date: new Date('2026-06-13T18:00:00Z'),
                endDate: new Date('2026-06-13T20:00:00Z'),
                location: 'Main Field',
                status: 'scheduled'
            }
        ]);

        expect(ics).toContain('DTSTART:20260613T180000Z');
        expect(ics).toContain('DTEND:20260613T200000Z');
    });

    it('falls back to two hours for games without saved end times', () => {
        const { buildIcs } = createTeamIcsHooks();
        const ics = buildIcs([
            {
                id: 'game-2',
                type: 'game',
                opponent: 'Lions',
                date: new Date('2026-06-14T18:00:00Z'),
                location: 'North Field',
                status: 'scheduled'
            }
        ]);

        expect(ics).toContain('DTSTART:20260614T180000Z');
        expect(ics).toContain('DTEND:20260614T200000Z');
    });
});
