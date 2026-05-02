import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    formatRegistrationImportResults,
    getRegistrationScheduleEvents,
    isExternallyLinkedRegistrationTeam,
    planRegistrationScheduleImport
} from '../../js/edit-schedule-registration-import.js';

const Timestamp = {
    fromDate: (date) => ({ toDate: () => date, iso: date.toISOString() })
};

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('registration schedule import planning', () => {
    it('detects externally linked teams and schedule snapshots', () => {
        expect(isExternallyLinkedRegistrationTeam({})).toBe(false);
        expect(isExternallyLinkedRegistrationTeam({ registrationSourceId: 'sports-connect' })).toBe(true);
        expect(getRegistrationScheduleEvents({ registrationSourceSnapshot: { scheduleEvents: [{ id: 'evt-1' }] } })).toEqual([{ id: 'evt-1' }]);
    });

    it('creates source-id based add and update operations without duplicating local-only conflicts', () => {
        const plan = planRegistrationScheduleImport({
            Timestamp,
            source: { type: 'sports-connect', id: 'league-1' },
            sourceEvents: [
                {
                    externalEventId: 'ext-1',
                    type: 'game',
                    start: '2026-05-01T18:00:00.000Z',
                    opponent: 'Tigers',
                    location: 'Field 1'
                },
                {
                    externalEventId: 'ext-2',
                    type: 'game',
                    start: '2026-05-02T18:00:00.000Z',
                    opponent: 'Bears',
                    location: 'Field 2'
                },
                {
                    externalEventId: 'ext-3',
                    type: 'game',
                    start: '2026-05-03T18:00:00.000Z',
                    opponent: 'Hawks'
                },
                {
                    externalEventId: 'ext-3',
                    type: 'game',
                    start: '2026-05-03T18:00:00.000Z',
                    opponent: 'Hawks'
                }
            ],
            existingEvents: [
                {
                    id: 'game-1',
                    type: 'game',
                    date: new Date('2026-05-01T18:00:00.000Z'),
                    opponent: 'Tigers',
                    sourceMetadata: { externalEventId: 'ext-1' }
                },
                {
                    id: 'game-2',
                    type: 'game',
                    date: new Date('2026-05-02T18:00:00.000Z'),
                    opponent: 'Bears'
                }
            ]
        });

        expect(plan.results).toMatchObject({
            added: 1,
            updated: 1,
            skipped: 1,
            conflicted: 1
        });
        expect(plan.results.conflicts).toEqual([{ externalEventId: 'ext-2', existingEventId: 'game-2' }]);
        expect(plan.operations).toHaveLength(2);
        expect(plan.operations[0]).toMatchObject({
            type: 'update',
            eventId: 'game-1',
            payload: {
                opponent: 'Tigers',
                location: 'Field 1',
                sourceMetadata: {
                    sourceType: 'sports-connect',
                    sourceId: 'league-1',
                    externalEventId: 'ext-1'
                }
            }
        });
        expect(plan.operations[1]).toMatchObject({
            type: 'add',
            eventType: 'game',
            payload: {
                opponent: 'Hawks',
                sourceMetadata: {
                    externalEventId: 'ext-3'
                }
            }
        });
    });

    it('formats import result counts for the UI', () => {
        expect(formatRegistrationImportResults({ added: 2, updated: 1, skipped: 0, conflicted: 3 }))
            .toBe('2 added, 1 updated, 0 skipped, 3 conflicted');
    });
});

describe('registration schedule import wiring', () => {
    it('shows the manual re-import action and routes through the shared helper', () => {
        const source = readEditSchedule();

        expect(source).toContain('id="registration-schedule-import"');
        expect(source).toContain('Re-import Schedule');
        expect(source).toContain("import { formatRegistrationImportResults, getRegistrationScheduleEvents, isExternallyLinkedRegistrationTeam, planRegistrationScheduleImport } from './js/edit-schedule-registration-import.js?v=1';");
        expect(source).toContain('planRegistrationScheduleImport({');
        expect(source).toContain('sourceMetadata?.externalEventId');
    });
});
