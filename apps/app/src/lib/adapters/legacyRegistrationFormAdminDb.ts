import * as legacyFirebase from '@legacy/firebase.js';

function callLegacyFirebase(name: string, args: any[]) {
  const fn = (legacyFirebase as Record<string, any>)[name];
  if (typeof fn !== 'function') {
    throw new TypeError(`Legacy firebase binding ${String(name)} is not available.`);
  }
  return fn(...args);
}

export const db: unknown = legacyFirebase.db;
export const collection = (...args: any[]) => callLegacyFirebase('collection', args);
export const doc = (...args: any[]) => callLegacyFirebase('doc', args);
export const getDoc = (...args: any[]) => callLegacyFirebase('getDoc', args);
export const getDocs = (...args: any[]) => callLegacyFirebase('getDocs', args);
export const runTransaction = (...args: any[]) => callLegacyFirebase('runTransaction', args);
export const serverTimestamp = (...args: any[]) => callLegacyFirebase('serverTimestamp', args);
export const setDoc = (...args: any[]) => callLegacyFirebase('setDoc', args);
export const query = (...args: any[]) => callLegacyFirebase('query', args);
export const orderBy = (...args: any[]) => callLegacyFirebase('orderBy', args);
export const documentId = (...args: any[]) => callLegacyFirebase('documentId', args);
export const limit = (...args: any[]) => callLegacyFirebase('limit', args);
export const startAfter = (...args: any[]) => callLegacyFirebase('startAfter', args);
export const updateDoc = (...args: any[]) => callLegacyFirebase('updateDoc', args);
