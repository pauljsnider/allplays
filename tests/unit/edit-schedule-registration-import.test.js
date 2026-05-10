import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    buildRegistrationScheduleImportPreview,
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
            duplicates: 1,
            skipped: 0,
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

    it('builds preview rows for selectable imports, unchanged entries, duplicates, and local conflicts', () => {
        const rows = buildRegistrationScheduleImportPreview({
            Timestamp,
            source: { type: 'sports-connect', id: 'league-1' },
            sourceEvents: [
                {
                    externalEventId: 'ext-new',
                    type: 'practice',
                    start: '2026-05-01T18:00:00.000Z',
                    title: 'Practice',
                    location: 'Gym'
                },
                {
                    externalEventId: 'ext-same',
                    type: 'game',
                    start: '2026-05-02T18:00:00.000Z',
                    opponent: 'Bears',
                    location: 'Field 2'
                },
                {
                    externalEventId: 'ext-new',
                    type: 'practice',
                    start: '2026-05-01T18:00:00.000Z',
                    title: 'Practice',
                    location: 'Gym'
                },
                {
                    externalEventId: 'ext-conflict',
                    type: 'game',
                    start: '2026-05-03T18:00:00.000Z',
                    opponent: 'Bears'
                }
            ],
            existingEvents: [
                {
                    id: 'game-same',
                    type: 'game',
                    date: new Date('2026-05-02T18:00:00.000Z'),
                    opponent: 'Bears',
                    location: 'Field 2',
                    status: 'scheduled',
                    isHome: true,
                    sourceMetadata: { sourceType: 'sports-connect', sourceId: 'league-1', externalEventId: 'ext-same' }
                },
                {
                    id: 'game-2',
                    type: 'game',
                    date: new Date('2026-05-03T18:00:00.000Z'),
                    opponent: 'Bears'
                }
            ]
        });

        expect(rows).toEqual([
            expect.objectContaining({ action: 'add', selectable: true, payload: expect.objectContaining({ type: 'practice', title: 'Practice', location: 'Gym' }) }),
            expect.objectContaining({ action: 'unchanged', selectable: false, existingEventId: 'game-same' }),
            expect.objectContaining({ action: 'duplicate', selectable: false }),
            expect.objectContaining({ action: 'conflict', selectable: false, existingEventId: 'game-2' })
        ]);
    });

    it('formats import result counts for the UI', () => {
        expect(formatRegistrationImportResults({ added: 2, updated: 1, unchanged: 4, duplicates: 1, skipped: 0, conflicted: 3 }))
            .toBe('2 added, 1 updated, 4 unchanged, 1 duplicate, 0 skipped, 3 conflicted');
    });
});

describe('registration schedule import wiring', () => {
    it('shows the manual re-import action and routes through the shared helper', () => {
        const source = readEditSchedule();

        expect(source).toContain('id="registration-schedule-import"');
        expect(source).toContain('id="registration-schedule-import-preview"');
        expect(source).toContain('Import Selected');
        expect(source).toContain("import { buildRegistrationScheduleImportPreview, formatRegistrationImportResults, getRegistrationScheduleEvents, isExternallyLinkedRegistrationTeam, planRegistrationScheduleImport } from './js/edit-schedule-registration-import.js?v=4';");
        expect(source).toContain('buildRegistrationScheduleImportPreview({');
        expect(source).toContain('registration-schedule-import-choice:checked');
        expect(source).toContain('sourceMetadata?.externalEventId');
        expect(source).toContain('registrationScheduleImportStatus');
        expect(source).toContain('registrationScheduleLastImportedAt');
    });
});
