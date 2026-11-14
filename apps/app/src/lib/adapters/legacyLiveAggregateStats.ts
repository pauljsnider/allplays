import { liveStatsMetadata as metadata, readLiveStatsForWrite as read, liveStatsMatchEpoch as match } from '@legacy/live-aggregate-stats.js';

export const liveStatsMetadata = metadata as (game: Record<string, unknown>) => {
  liveStatsVersion: number;
  liveStatsEpoch: string;
};
export const readLiveStats = read as (
  row: Record<string, unknown>, game: Record<string, unknown>
) => Record<string, number>;
export const liveStatsMatchEpoch = match as (row: Record<string, unknown>, game: Record<string, unknown>) => boolean;
