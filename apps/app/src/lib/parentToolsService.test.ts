// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

function createAnyFnModule(overrides: Record<string, unknown> = {}) {
    return new Proxy({ __esModule: true, ...overrides }, {
        get(target, prop) {
            if (typeof prop === 'symbol' || prop === 'then' || prop === 'catch' || prop === 'finally') {
                return undefined;
            }
            if (prop in target) return target[prop as keyof typeof target];
            return vi.fn();
        }
    });
}

vi.mock('../../../../js/db.js', () => createAnyFnModule());
vi.mock('../../../../js/family-plan.js', () => createAnyFnModule());
vi.mock('../../../../js/firebase.js', () => createAnyFnModule({ db: {} }));
vi.mock('../../../../js/parent-dashboard-fees.js', () => createAnyFnModule());
vi.mock('../../../../js/stripe-service.js', () => createAnyFnModule());
vi.mock('../../../../js/registration-flow.js', () => createAnyFnModule());
vi.mock('../../../../js/team-media-utils.js', () => createAnyFnModule());
vi.mock('./authService', () => ({ firebaseAuth: { currentUser: null }, getNativeAuthIdToken: vi.fn() }));
vi.mock('./scheduleService', () => ({ loadParentSchedule: vi.fn() }));

import { buildParentScheduleEventIcs } from './parentToolsService';

describe('buildParentScheduleEventIcs', () => {
    it('builds a single-event game calendar file with a fallback end time', () => {
        const event = {
            eventKey: 'team-1::game-1::player-1',
            id: 'game-1',
            teamId: 'team-1',
            teamName: 'Bears',
            type: 'game',
            date: new Date('2026-06-07T15:00:00Z'),
            location: 'Field 1',
            opponent: 'Wildcats',
            childId: 'player-1',
            childName: 'Sam Player',
            isDbGame: true,
            isCancelled: false,
            assignments: [],
            notes: 'Bring water'
        } as any;

        const ics = buildParentScheduleEventIcs(event, 'Game Day');

        expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(1);
        expect(ics).toContain('X-WR-CALNAME:Game Day');
        expect(ics).toContain('SUMMARY:vs. Wildcats');
        expect(ics).toContain('DTSTART:20260607T150000Z');
        expect(ics).toContain('DTEND:20260607T160000Z');
        expect(ics).toContain('LOCATION:Field 1');
        expect(ics).toContain('DESCRIPTION:Bears\\nGame\\nPlayer: Sam Player\\nBring water');
    });

    it('builds a single-event practice calendar file with the provided end time', () => {
        const event = {
            eventKey: 'team-1::practice-1::player-1',
            id: 'practice-1',
            teamId: 'team-1',
            teamName: 'Bears',
            type: 'practice',
            title: 'Speed Training',
            date: new Date('2026-06-08T17:30:00Z'),
            endDate: new Date('2026-06-08T19:00:00Z'),
            location: 'Main Gym',
            childId: 'player-1',
            childName: 'Sam Player',
            isDbGame: true,
            isCancelled: false,
            assignments: []
        } as any;

        const ics = buildParentScheduleEventIcs(event);

        expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(1);
        expect(ics).toContain('SUMMARY:Speed Training');
        expect(ics).toContain('DTSTART:20260608T173000Z');
        expect(ics).toContain('DTEND:20260608T190000Z');
        expect(ics).toContain('LOCATION:Main Gym');
        expect(ics).toContain('DESCRIPTION:Bears\\nPractice\\nPlayer: Sam Player');
    });
});
