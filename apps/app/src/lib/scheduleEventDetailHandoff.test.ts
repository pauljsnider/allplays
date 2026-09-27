import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearScheduleEventDetailHandoffForTest,
  consumeScheduleEventDetailHandoff,
  storeScheduleEventDetailHandoff
} from './scheduleEventDetailHandoff';
import type { ParentScheduleLoadResult } from './scheduleService';

const result: ParentScheduleLoadResult = {
  children: [],
  events: []
};

describe('schedule event detail handoff', () => {
  beforeEach(() => {
    clearScheduleEventDetailHandoffForTest();
  });

  it('returns a matching user and route result exactly once', () => {
    storeScheduleEventDetailHandoff('user-1', 'team-1', 'event-1', result);

    expect(consumeScheduleEventDetailHandoff('user-1', 'team-1', 'event-1')).toBe(result);
    expect(consumeScheduleEventDetailHandoff('user-1', 'team-1', 'event-1')).toBeNull();
  });

  it.each([
    ['another user', 'user-2', 'team-1', 'event-1'],
    ['another team', 'user-1', 'team-2', 'event-1'],
    ['another event', 'user-1', 'team-1', 'event-2']
  ])('rejects and deletes a handoff requested by %s', (_label, userId, teamId, eventId) => {
    storeScheduleEventDetailHandoff('user-1', 'team-1', 'event-1', result);

    expect(consumeScheduleEventDetailHandoff(userId, teamId, eventId)).toBeNull();
    expect(consumeScheduleEventDetailHandoff('user-1', 'team-1', 'event-1')).toBeNull();
  });
});
