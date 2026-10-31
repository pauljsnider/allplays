import { describe, expect, it } from 'vitest';
import { mapScheduleEventRecord } from './mappers';

describe('numeric clock timestamp mapping', () => {
  it.each([0, 1793448000000])('accepts epoch milliseconds %s', (epoch) => {
    const event = mapScheduleEventRecord({ id: 'game', date: new Date(), liveClockUpdatedAt: epoch });
    expect(event?.liveClockUpdatedAt).toEqual(new Date(epoch));
  });
  it.each([NaN, Infinity, -Infinity, 1e20])('rejects invalid numeric timestamp %s', (epoch) => {
    const event = mapScheduleEventRecord({ id: 'game', date: new Date(), liveClockUpdatedAt: epoch });
    expect(event?.liveClockUpdatedAt).toBeNull();
  });
});
