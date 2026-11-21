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

import { decodeFirestoreFields } from './mappers';
import { liveStatsMetadata, readLiveStats } from '../adapters/legacyLiveAggregateStats';

it('preserves millisecond reset epochs across native REST decoding, SDK timestamps and writes', () => {
  const iso = '2026-11-14T20:05:23.789Z';
  const millis = new Date(iso).getTime();
  const nativeGame = decodeFirestoreFields({liveResetAt: {timestampValue: iso}});
  const sdkGame = {liveResetAt: {toMillis: () => millis}};
  const metadata = liveStatsMetadata(sdkGame);
  expect(metadata.liveStatsEpoch).toBe(`time:${millis}`);
  expect(liveStatsMetadata(nativeGame)).toEqual(metadata);
  expect(readLiveStats({stats:{pts:12},...metadata},nativeGame)).toEqual({pts:12});
  expect(readLiveStats({stats:{pts:14},...liveStatsMetadata(nativeGame)},sdkGame)).toEqual({pts:14});
  expect(() => readLiveStats({stats:{pts:12}},nativeGame)).toThrow('unknown reset epoch');
});
