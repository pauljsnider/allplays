import {
  db as legacyDb,
  collection as legacyCollection,
  getDocs as legacyGetDocs,
  doc as legacyDoc,
  getDoc as legacyGetDoc,
  setDoc as legacySetDoc,
  addDoc as legacyAddDoc,
  updateDoc as legacyUpdateDoc,
  deleteDoc as legacyDeleteDoc,
  query as legacyQuery,
  where as legacyWhere,
  limit as legacyLimit,
  Timestamp as LegacyTimestamp,
  serverTimestamp as legacyServerTimestamp
} from '@legacy/firebase.js';

/**
 * Typed adapter boundary for the legacy js/ Firestore primitives used by
 * socialService (#2066). SDK shapes stay loose; bindings re-exported as-is.
 */
export const db: unknown = legacyDb;
export const collection = legacyCollection as (...args: any[]) => any;
export const getDocs = legacyGetDocs as (...args: any[]) => Promise<any>;
export const doc = legacyDoc as (...args: any[]) => any;
export const getDoc = legacyGetDoc as (...args: any[]) => Promise<any>;
export const setDoc = legacySetDoc as (...args: any[]) => Promise<any>;
export const addDoc = legacyAddDoc as (...args: any[]) => Promise<any>;
export const updateDoc = legacyUpdateDoc as (...args: any[]) => Promise<any>;
export const deleteDoc = legacyDeleteDoc as (...args: any[]) => Promise<any>;
export const query = legacyQuery as (...args: any[]) => any;
export const where = legacyWhere as (...args: any[]) => any;
export const limit = legacyLimit as (...args: any[]) => any;
export const Timestamp = LegacyTimestamp as any;
export const serverTimestamp = legacyServerTimestamp as (...args: any[]) => any;
