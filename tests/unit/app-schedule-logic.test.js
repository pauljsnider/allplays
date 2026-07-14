import { describe, expect, it } from 'vitest';
import {
    buildScheduleIcs,
    buildScheduleAgendaText,
    canSubmitScheduleEventRsvp,
    canRequestScheduleRide,
    findScheduleRideRequestForChild,
    filterParentScheduleEvents,
    getCalendarScheduleEntries,
    getScheduleEventDetailPath,
    getNextRideConfirmedSeatCount,
    getOpenScheduleAssignments,
    getParentScheduleTeamOptions,
    getPracticePacketRows,
    getScheduleAssignmentStatus,
    PRACTICE_PACKET_DETAIL_SECTION,
    getScheduleMapHref,
    getScheduleRideSeatInfo,
    getScheduleRideshareSummary,
    getScheduleTaskDetailSection,
    isScheduleAssignmentClaimedByUser,
    isScheduleAssignmentOpen,
    normalizeScheduleAssignment,
    validateExternalCalendarUrl
} from '../../apps/app/src/lib/scheduleLogic';

function event(overrides = {}) {
    return {
        eventKey: overrides.eventKey || `${overrides.teamId || 'team-1'}::${overrides.id || 'game-1'}::${overrides.childId || 'player-1'}`,
        id: overrides.id || 'game-1',
        teamId: overrides.teamId || 'team-1',
        teamName: overrides.teamName || 'Bears',
        type: overrides.type || 'game',
        date: overrides.date || new Date('2026-05-21T18:00:00Z'),
        location: overrides.location || 'Main Gym',
        opponent: overrides.opponent || 'Falcons',
        title: overrides.title || null,
        childId: overrides.childId || 'player-1',
        childName: overrides.childName || 'Pat',
        isDbGame: overrides.isDbGame !== false,
        isCancelled: overrides.isCancelled === true,
        myRsvp: overrides.myRsvp || 'not_responded',
        rsvpSummary: overrides.rsvpSummary || null,
        rideshareSummary: overrides.rideshareSummary || null,
        assignments: overrides.assignments || [],
        ...overrides
    };
}

describe('React app parent schedule logic', () => {

    it('treats only active tracked events before the cutoff as RSVP-actionable', () => {
        expect(canSubmitScheduleEventRsvp(event())).toBe(true);
        expect(canSubmitScheduleEventRsvp(event({ isDbGame: false }))).toBe(false);
        expect(canSubmitScheduleEventRsvp(event({ isCancelled: true }))).toBe(false);
        expect(canSubmitScheduleEventRsvp(event({ availabilityLocked: true }))).toBe(false);
    });

    it('validates external calendar .ics URLs like legacy schedule import', () => {
        expect(validateExternalCalendarUrl('')).toMatchObject({ valid: false, error: 'Enter a calendar .ics URL.' });
        expect(validateExternalCalendarUrl('https://example.com/calendar')).toMatchObject({ valid: false, error: 'Calendar URL must be an .ics link.' });
        expect(validateExternalCalendarUrl('  https://example.com/team.ics?token=abc  ')).toEqual({
            valid: true,
            url: 'https://example.com/team.ics?token=abc',
            error: null
        });
    });

    it('keeps parent task-targeted event detail routes explicit', () => {
        const generic = event({
            teamId: 'team/with slash',
            id: 'game 1',
            childId: 'player 1',
            myRsvp: 'going'
        });
        const rsvpNeeded = event({
            id: 'game-rsvp',
            myRsvp: 'not_responded',
            assignments: [{ role: 'Snacks', value: '', claimable: true, claim: null }],
            rideshareSummary: { offerCount: 1, seatsLeft: 1, requests: 1, pending: 1, confirmed: 0, isFull: false }
        });
        const packet = event({
            id: 'practice-1',
            type: 'practice',
            isDbGame: false,
            practiceHomePacketSummary: '2 drills'
        });
        const assignment = event({
            myRsvp: 'going',
            assignments: [{ role: 'Snacks', value: '', claimable: true, claim: null }]
        });
        const ride = event({
            myRsvp: 'going',
            rideshareSummary: { offerCount: 1, seatsLeft: 1, requests: 0, pending: 0, confirmed: 0, isFull: false }
        });
        const lockedRsvp = event({
            id: 'game-locked',
            myRsvp: 'not_responded',
            availabilityLocked: true
        });

        expect(getScheduleTaskDetailSection(generic)).toBe('');
        expect(getScheduleEventDetailPath(generic, getScheduleTaskDetailSection(generic))).toBe('/schedule/team%2Fwith%20slash/game%201?childId=player+1');
        expect(getScheduleTaskDetailSection(rsvpNeeded)).toBe('availability');
        expect(getScheduleEventDetailPath(rsvpNeeded, getScheduleTaskDetailSection(rsvpNeeded))).toBe('/schedule/team-1/game-rsvp?childId=player-1&section=availability');
        expect(PRACTICE_PACKET_DETAIL_SECTION).toBe('game');
        expect(getScheduleTaskDetailSection(packet)).toBe(PRACTICE_PACKET_DETAIL_SECTION);
        expect(getScheduleEventDetailPath(packet, getScheduleTaskDetailSection(packet))).toBe('/schedule/team-1/practice-1?childId=player-1&section=game');
        expect(getScheduleEventDetailPath(assignment, getScheduleTaskDetailSection(assignment))).toBe('/schedule/team-1/game-1?childId=player-1&section=assignments');
        expect(getScheduleEventDetailPath(ride, getScheduleTaskDetailSection(ride))).toBe('/schedule/team-1/game-1?childId=player-1&section=rideshare');
        expect(getScheduleTaskDetailSection(lockedRsvp)).toBe('');
        expect(getScheduleEventDetailPath(lockedRsvp, getScheduleTaskDetailSection(lockedRsvp))).toBe('/schedule/team-1/game-locked?childId=player-1');
    });

    it('matches parent-dashboard upcoming and past filter behavior with a three-hour cutoff', () => {
        const now = new Date('2026-05-20T12:00:00Z');
        const events = [
            event({ id: 'old', date: new Date('2026-05-20T08:30:00Z') }),
            event({ id: 'recent', date: new Date('2026-05-20T10:00:00Z') }),
            event({ id: 'future-game', date: new Date('2026-05-21T18:00:00Z') }),
            event({ id: 'future-practice', type: 'practice', date: new Date('2026-05-21T19:00:00Z') })
        ];

        expect(filterParentScheduleEvents(events, { filter: 'upcoming-all', now }).map((item) => item.id)).toEqual([
            'recent',
            'future-game',
            'future-practice'
        ]);
        expect(filterParentScheduleEvents(events, { filter: 'upcoming-games', now }).map((item) => item.id)).toEqual([
            'recent',
            'future-game'
        ]);
        expect(filterParentScheduleEvents(events, { filter: 'upcoming-practices', now }).map((item) => item.id)).toEqual([
            'future-practice'
        ]);
        expect(filterParentScheduleEvents(events, { filter: 'past-all', now }).map((item) => item.id)).toEqual([
            'old'
        ]);
    });

    it('filters by linked player before applying schedule filter', () => {
        const now = new Date('2026-05-20T12:00:00Z');
        const events = [
            event({ id: 'player-1-game', childId: 'player-1', childName: 'Pat' }),
            event({ id: 'player-2-game', childId: 'player-2', childName: 'Sam' })
        ];

        expect(filterParentScheduleEvents(events, { filter: 'upcoming-all', playerId: 'player-2', now }).map((item) => item.id)).toEqual([
            'player-2-game'
        ]);
    });

    it('supports parent parity filters for team, range, availability, and recent results', () => {
        const now = new Date('2026-05-20T12:00:00Z');
        const events = [
            event({ id: 'needs-rsvp', teamId: 'team-1', date: new Date('2026-05-21T18:00:00Z'), myRsvp: 'not_responded' }),
            event({ id: 'done-rsvp', teamId: 'team-1', date: new Date('2026-05-22T18:00:00Z'), myRsvp: 'going' }),
            event({ id: 'other-team', teamId: 'team-2', date: new Date('2026-05-21T18:00:00Z'), myRsvp: 'not_responded' }),
            event({ id: 'future-month', teamId: 'team-1', date: new Date('2026-07-01T18:00:00Z'), myRsvp: 'not_responded' }),
            event({ id: 'final', teamId: 'team-1', date: new Date('2026-05-10T18:00:00Z'), status: 'completed', liveStatus: 'completed' })
        ];

        expect(filterParentScheduleEvents(events, { filter: 'availability', teamId: 'team-1', now }).map((item) => item.id)).toEqual([
            'needs-rsvp',
            'future-month',
            'done-rsvp'
        ]);
        expect(filterParentScheduleEvents(events, { filter: 'upcoming-all', teamId: 'team-1', timeRange: 'week', now }).map((item) => item.id)).toEqual([
            'needs-rsvp',
            'done-rsvp'
        ]);
        expect(filterParentScheduleEvents(events, { filter: 'recent-results', teamId: 'team-1', now }).map((item) => item.id)).toEqual([
            'final'
        ]);
    });

    it('groups calendar entries by team, event, date, and type while preserving child RSVP rows', () => {
        const date = new Date('2026-05-21T18:00:00Z');
        const grouped = getCalendarScheduleEntries([
            event({ id: 'game-1', childId: 'player-1', childName: 'Pat', myRsvp: 'going', date }),
            event({ id: 'game-1', childId: 'player-2', childName: 'Sam', myRsvp: 'maybe', date }),
            event({ id: 'practice-1', type: 'practice', childId: 'player-1', childName: 'Pat', date })
        ]);

        expect(grouped).toHaveLength(2);
        expect(grouped[0].childNames).toEqual(['Pat', 'Sam']);
        expect(grouped[0].childRsvps).toEqual([
            { childId: 'player-1', childName: 'Pat', myRsvp: 'going' },
            { childId: 'player-2', childName: 'Sam', myRsvp: 'maybe' }
        ]);
    });

    it('exports one ICS event for duplicate family entries on the same team event', () => {
        const date = new Date('2026-05-21T18:00:00Z');
        const ics = buildScheduleIcs([
            event({ id: 'game-1', childId: 'player-1', childName: 'Pat', date, arrivalTime: new Date('2026-05-21T17:30:00Z'), notes: 'Bring blue kit' }),
            event({ id: 'game-1', childId: 'player-2', childName: 'Sam', date })
        ], new Date('2026-05-20T12:00:00Z'));

        expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(1);
        expect(ics).toContain('SUMMARY:Pat vs Falcons');
        expect(ics).toContain('LOCATION:Main Gym');
        expect(ics).toContain('Arrival:');
        expect(ics).toContain('Bring blue kit');
    });

    it('builds team options, packet rows, agenda text, and map links for shared UX', () => {
        const now = new Date('2026-05-20T12:00:00Z');
        const events = [
            event({ id: 'game-1', teamId: 'team-1', teamName: 'Bears', childId: 'player-1', childName: 'Pat' }),
            event({
                id: 'practice-1',
                type: 'practice',
                teamId: 'team-2',
                teamName: 'Hawks',
                childId: 'player-2',
                childName: 'Sam',
                date: new Date('2026-05-21T19:00:00Z'),
                practiceHomePacketSummary: '2 drills · 20 min',
                practicePacketCompletions: []
            }),
            event({
                id: 'practice-2',
                type: 'practice',
                teamId: 'team-2',
                teamName: 'Hawks',
                childId: 'player-2',
                childName: 'Sam',
                date: new Date('2026-05-22T19:00:00Z'),
                practiceHomePacketSummary: '1 drill · 10 min',
                practicePacketCompletions: [{ childId: 'player-2', status: 'completed' }]
            })
        ];

        expect(getParentScheduleTeamOptions(events).map((team) => ({ teamId: team.teamId, playerCount: team.playerCount }))).toEqual([
            { teamId: 'team-1', playerCount: 1 },
            { teamId: 'team-2', playerCount: 1 }
        ]);
        expect(getPracticePacketRows(events, now).map((row) => `${row.event.id}:${row.status}`)).toEqual([
            'practice-1:ready',
            'practice-2:completed'
        ]);
        expect(buildScheduleAgendaText(events)).toContain('Bears');
        expect(getScheduleMapHref('Garmin Field #4N')).toContain('Garmin+Field');
        expect(getScheduleMapHref('TBD')).toBe('');
    });

    it('summarizes rideshare offers and request availability like the parent dashboard', () => {
        const offer = {
            id: 'offer-1',
            driverUserId: 'driver-1',
            seatCapacity: 3,
            seatCountConfirmed: 1,
            status: 'open',
            requests: [
                { id: 'request-1', parentUserId: 'parent-1', childId: 'player-1', childName: 'Pat', status: 'pending' },
                { id: 'request-2', parentUserId: 'parent-2', childId: 'player-2', childName: 'Sam', status: 'confirmed' }
            ]
        };

        expect(getScheduleRideSeatInfo(offer)).toMatchObject({ seatCapacity: 3, seatCountConfirmed: 1, seatsLeft: 2, isFull: false });
        expect(getScheduleRideshareSummary([offer, { id: 'closed', status: 'closed', seatCapacity: 4, seatCountConfirmed: 0, requests: [] }])).toEqual({
            offerCount: 1,
            seatsLeft: 2,
            requests: 2,
            pending: 1,
            confirmed: 1,
            isFull: false
        });
        expect(findScheduleRideRequestForChild(offer, 'parent-1', 'player-1')?.id).toBe('request-1');
        expect(canRequestScheduleRide(offer, 'parent-1', 'player-1')).toBe(false);
        expect(canRequestScheduleRide(offer, 'parent-3', 'player-3')).toBe(true);
        expect(canRequestScheduleRide(offer, 'driver-1', 'player-3')).toBe(false);
        expect(canRequestScheduleRide({ ...offer, seatCountConfirmed: 3, requests: [] }, 'parent-3', 'player-3')).toBe(true);
        expect(canRequestScheduleRide({
            ...offer,
            seatCountConfirmed: 3,
            requests: [{ id: 'request-3', parentUserId: 'parent-3', childId: 'player-3', status: 'waitlisted' }]
        }, 'parent-3', 'player-3')).toBe(false);
    });

    it('keeps confirmed seat counts stable when ride requests change status', () => {
        expect(getNextRideConfirmedSeatCount(1, 'pending', 'confirmed')).toBe(2);
        expect(getNextRideConfirmedSeatCount(2, 'confirmed', 'waitlisted')).toBe(1);
        expect(getNextRideConfirmedSeatCount(0, 'confirmed', 'declined')).toBe(0);
    });

    it('matches parent dashboard assignment claim display rules', () => {
        const assignments = [
            { role: 'Snacks', value: '', claimable: true, claim: null },
            { role: 'Scorebook', value: 'Jamie', claimable: false },
            { role: 'Drinks', value: '', claimable: true, claim: { claimedByUserId: 'user-1', claimedByName: 'Pat Parent' } },
            { role: 'Setup', value: '', claimable: true, claim: { claimedByUserId: 'other', claimedByName: 'Taylor' } }
        ];

        expect(getOpenScheduleAssignments(assignments).map((assignment) => assignment.role)).toEqual(['Snacks']);
        expect(isScheduleAssignmentOpen(assignments[0])).toBe(true);
        expect(isScheduleAssignmentClaimedByUser(assignments[2], 'user-1')).toBe(true);
        expect(getScheduleAssignmentStatus(assignments[0], 'user-1')).toBe('Open');
        expect(getScheduleAssignmentStatus(assignments[1], 'user-1')).toBe('Jamie');
        expect(getScheduleAssignmentStatus(assignments[2], 'user-1')).toBe('You');
        expect(getScheduleAssignmentStatus(assignments[3], 'user-1')).toBe('Taylor');
    });

    it('normalizes assignment rows before deciding what needs parent action', () => {
        const assignments = [
            { role: ' Snacks ', value: ' ', claimable: true },
            { role: 'Scorebook', value: ' Jamie ', claimable: false },
            { role: 'Drinks', value: '', claimable: false },
            { role: '', value: '', claimable: true },
            { role: 'Setup', value: '', claimable: true, claim: { claimedByUserId: 'other-parent' } }
        ];

        expect(normalizeScheduleAssignment(assignments[0])).toEqual({
            role: 'Snacks',
            value: '',
            claimable: true,
            claim: null
        });
        expect(getOpenScheduleAssignments(assignments).map((assignment) => assignment.role)).toEqual(['Snacks']);
        expect(getScheduleAssignmentStatus(assignments[1], 'user-1')).toBe('Jamie');
        expect(getScheduleAssignmentStatus(assignments[4], 'user-1')).toBe('Taken');
    });

    it('handles cancelled, imported, final, and locked schedule edge cases without creating parent actions', () => {
        const now = new Date('2026-05-20T12:00:00Z');
        const events = [
            event({ id: 'cancelled', isCancelled: true, date: new Date('2026-05-21T18:00:00Z') }),
            event({ id: 'imported', isDbGame: false, isImported: true, sourceType: 'calendar', date: new Date('2026-05-21T19:00:00Z') }),
            event({ id: 'final-status', status: 'final', liveStatus: 'completed', date: new Date('2026-05-20T11:00:00Z'), homeScore: 3, awayScore: 2 }),
            event({ id: 'needs-rsvp', myRsvp: 'not_responded', date: new Date('2026-05-22T18:00:00Z') })
        ];

        expect(filterParentScheduleEvents(events, { filter: 'availability', now }).map((item) => item.id)).toEqual([
            'needs-rsvp'
        ]);
        expect(filterParentScheduleEvents(events, { filter: 'recent-results', now }).map((item) => item.id)).toEqual([
            'final-status'
        ]);
        expect(filterParentScheduleEvents(events, { filter: 'upcoming-all', now }).map((item) => item.id)).toEqual([
            'cancelled',
            'imported',
            'needs-rsvp'
        ]);
        expect(getCalendarScheduleEntries(events).find((item) => item.id === 'imported')).toMatchObject({
            isDbGame: false,
            isImported: true,
            sourceType: 'calendar'
        });
    });

    it('exports stable ICS data across explicit end times, punctuation, and DST boundaries', () => {
        const ics = buildScheduleIcs([
            event({
                id: 'dst-game',
                date: new Date('2026-03-08T07:30:00Z'),
                endDate: new Date('2026-03-08T09:00:00Z'),
                location: 'Field, North; Gate 2',
                notes: 'Line one\nLine two'
            })
        ], new Date('2026-03-07T12:00:00Z'));

        expect(ics).toContain('DTSTART:20260308T073000Z');
        expect(ics).toContain('DTEND:20260308T090000Z');
        expect(ics).toContain('LOCATION:Field\\, North\\; Gate 2');
        expect(ics).toContain('Line one\\nLine two');
    });
});
