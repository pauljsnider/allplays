import { describe, it, expect } from 'vitest';
import { resolvePracticePacketSessionIdForEvent } from '../../js/parent-dashboard-packets.js';

describe('parent dashboard packet session resolver', () => {
  it('returns event practiceSessionId when present', () => {
    const result = resolvePracticePacketSessionIdForEvent(
      { practiceSessionId: 'session-direct', id: 'event-1' },
      [{ sessionId: 'session-other', eventId: 'event-1' }]
    );
    expect(result).toBe('session-direct');
  });

  it('resolves direct eventId match against session eventId', () => {
    const result = resolvePracticePacketSessionIdForEvent(
      { id: 'event-2' },
      [{ sessionId: 'session-2', eventId: 'event-2' }]
    );
    expect(result).toBe('session-2');
  });

  it('resolves recurring session by nearest date when eventId uses __ suffix', () => {
    const eventDate = new Date('2026-03-11T18:00:00Z');
    const result = resolvePracticePacketSessionIdForEvent(
      { id: 'master-event', date: eventDate },
      [
        { sessionId: 'session-a', eventId: 'master-event__2026-03-04', date: new Date('2026-03-04T18:00:00Z') },
        { sessionId: 'session-b', eventId: 'master-event__2026-03-11', date: new Date('2026-03-11T18:00:00Z') },
        { sessionId: 'session-c', eventId: 'master-event__2026-03-18', date: new Date('2026-03-18T18:00:00Z') }
      ]
    );
    expect(result).toBe('session-b');
  });

  it('returns null when no matching session exists', () => {
    const result = resolvePracticePacketSessionIdForEvent(
      { id: 'missing-event', date: new Date('2026-03-11T18:00:00Z') },
      [{ sessionId: 'session-x', eventId: 'different-event' }]
    );
    expect(result).toBeNull();
  });
});
