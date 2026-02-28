import { describe, it, expect } from 'vitest';
import { applyRsvpHydration } from '../../js/rsvp-hydration.js';

describe('RSVP hydration for recurring occurrences', () => {
  it('applies computed summary to recurring occurrence with null summary', () => {
    const events = [
      {
        id: 'practice-master__2026-03-01',
        teamId: 'team-1',
        rsvpSummary: null,
        myRsvp: null
      }
    ];

    applyRsvpHydration(events, 'team-1', 'practice-master__2026-03-01', {
      myRsvp: 'going',
      summary: { going: 2, maybe: 0, notGoing: 1, notResponded: 3, total: 6 }
    });

    expect(events[0].myRsvp).toBe('going');
    expect(events[0].rsvpSummary).toEqual({ going: 2, maybe: 0, notGoing: 1, notResponded: 3, total: 6 });
  });

  it('does not clear an existing summary when computed summary is unavailable', () => {
    const existing = { going: 1, maybe: 1, notGoing: 0, notResponded: 2, total: 4 };
    const events = [
      {
        id: 'game-1',
        teamId: 'team-1',
        rsvpSummary: existing,
        myRsvp: null
      }
    ];

    applyRsvpHydration(events, 'team-1', 'game-1', {
      myRsvp: 'maybe',
      summary: null
    });

    expect(events[0].myRsvp).toBe('maybe');
    expect(events[0].rsvpSummary).toBe(existing);
  });

  it('only updates matching team and event id', () => {
    const events = [
      { id: 'practice-master__2026-03-01', teamId: 'team-1', rsvpSummary: null, myRsvp: null },
      { id: 'practice-master__2026-03-01', teamId: 'team-2', rsvpSummary: null, myRsvp: null },
      { id: 'different-event', teamId: 'team-1', rsvpSummary: null, myRsvp: null }
    ];

    applyRsvpHydration(events, 'team-1', 'practice-master__2026-03-01', {
      myRsvp: 'not_going',
      summary: { going: 0, maybe: 0, notGoing: 2, notResponded: 1, total: 3 }
    });

    expect(events[0].myRsvp).toBe('not_going');
    expect(events[0].rsvpSummary?.notGoing).toBe(2);

    expect(events[1].myRsvp).toBeNull();
    expect(events[1].rsvpSummary).toBeNull();

    expect(events[2].myRsvp).toBeNull();
    expect(events[2].rsvpSummary).toBeNull();
  });
});
