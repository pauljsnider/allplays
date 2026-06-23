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
export const serverTimestamp = (...args: any[]) => callLegacyFirebase('serverTimestamp', args);
export const setDoc = (...args: any[]) => callLegacyFirebase('setDoc', args);
export const updateDoc = (...args: any[]) => callLegacyFirebase('updateDoc', args);
