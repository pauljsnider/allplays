import {
  collection as legacyCollection,
  db as legacyDb,
  doc as legacyDoc,
  functions as legacyFunctions,
  httpsCallable as legacyHttpsCallable,
  limit as legacyLimit,
  onSnapshot as legacyOnSnapshot,
  orderBy as legacyOrderBy,
  query as legacyQuery,
  updateDoc as legacyUpdateDoc,
  serverTimestamp as legacyServerTimestamp
} from '@legacy/firebase.js';

/**
 * Typed adapter boundary for the legacy js/ Firestore primitives used by
 * notificationInboxService (#2066). SDK shapes stay loose; bindings re-exported
 * as-is so existing js/* test mocks apply via the @legacy alias.
 */
export const collection = legacyCollection as (...args: any[]) => any;
export const db: unknown = legacyDb;
export const doc = legacyDoc as (...args: any[]) => any;
export const functions: unknown = legacyFunctions;
export const httpsCallable = legacyHttpsCallable as (...args: any[]) => (...callArgs: any[]) => Promise<any>;
export const limit = legacyLimit as (...args: any[]) => any;
export const onSnapshot = legacyOnSnapshot as (...args: any[]) => () => void;
export const orderBy = legacyOrderBy as (...args: any[]) => any;
export const query = legacyQuery as (...args: any[]) => any;
export const updateDoc = legacyUpdateDoc as (...args: any[]) => Promise<any>;
export const serverTimestamp = legacyServerTimestamp as (...args: any[]) => any;
