import { db as legacyDb, deleteDoc as legacyDeleteDoc, doc as legacyDoc, increment as legacyIncrement, setDoc as legacySetDoc } from '@legacy/firebase.js';
import { splitPlayerStatsByVisibility as legacySplitPlayerStatsByVisibility } from '@legacy/stat-leaderboards.js';

/**
 * Typed adapter boundary for the legacy js/ Firestore primitives + stat helper
 * used by statTrackingService (#2066). The Firestore SDK shapes stay loose; the
 * service injects these via its dependencies object.
 */
export const db: unknown = legacyDb;
export const doc = legacyDoc as (db: unknown, ...segments: string[]) => unknown;
export const setDoc = legacySetDoc as (ref: unknown, data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<unknown>;
export const deleteDoc = legacyDeleteDoc as (ref: unknown) => Promise<unknown>;
export const increment = legacyIncrement as (delta: number) => unknown;

export const splitPlayerStatsByVisibility = legacySplitPlayerStatsByVisibility as (
  statConfig: Record<string, unknown>,
  stats: Record<string, unknown>
) => { publicStats: Record<string, unknown>; privateStats: Record<string, unknown> };
