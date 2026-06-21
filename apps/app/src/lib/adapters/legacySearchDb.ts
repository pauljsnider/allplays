import { isTeamActive as legacyIsTeamActive } from '@legacy/team-visibility.js';
import { executeBoundedPlayerSearch as legacyExecuteBoundedPlayerSearch, playerSearchFirestoreQueryBudget as legacyPlayerSearchFirestoreQueryBudget, playerSearchResultLimit as legacyPlayerSearchResultLimit } from '@legacy/player-search-budget.js';
import {
  db as legacyDb,
  collection as legacyCollection,
  doc as legacyDoc,
  getDoc as legacyGetDoc,
  getDocs as legacyGetDocs,
  query as legacyQuery,
  where as legacyWhere,
  orderBy as legacyOrderBy,
  limit as legacyLimit
} from '@legacy/firebase.js';

/**
 * Typed adapter boundary for the legacy js/ search helpers + Firestore primitives
 * (#2066). Bindings re-exported as-is so existing js/* test mocks apply via the
 * @legacy alias; legacy shapes stay loose.
 */
export const isTeamActive = legacyIsTeamActive as (team: unknown) => boolean;
export const executeBoundedPlayerSearch = legacyExecuteBoundedPlayerSearch as (...args: any[]) => Promise<any>;
export const playerSearchFirestoreQueryBudget = legacyPlayerSearchFirestoreQueryBudget as number;
export const playerSearchResultLimit = legacyPlayerSearchResultLimit as number;
export const db: unknown = legacyDb;
export const collection = legacyCollection as (...args: any[]) => any;
export const doc = legacyDoc as (...args: any[]) => any;
export const getDoc = legacyGetDoc as (...args: any[]) => Promise<any>;
export const getDocs = legacyGetDocs as (...args: any[]) => Promise<any>;
export const query = legacyQuery as (...args: any[]) => any;
export const where = legacyWhere as (...args: any[]) => any;
export const orderBy = legacyOrderBy as (...args: any[]) => any;
export const limit = legacyLimit as (...args: any[]) => any;
