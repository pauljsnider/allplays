import { getUserProfile as legacyGetUserProfile } from '@legacy/db.js';
import {
  db as legacyDb,
  addDoc as legacyAddDoc,
  collection as legacyCollection,
  doc as legacyDoc,
  getDocs as legacyGetDocs,
  limit as legacyLimit,
  orderBy as legacyOrderBy,
  query as legacyQuery,
  serverTimestamp as legacyServerTimestamp,
  setDoc as legacySetDoc
} from '@legacy/firebase.js';
import { getApp as legacyGetApp } from '@legacy/vendor/firebase-app.js';
import { getAI as legacyGetAI, getGenerativeModel as legacyGetGenerativeModel, GoogleAIBackend as LegacyGoogleAIBackend } from '@legacy/vendor/firebase-ai.js';

/**
 * Typed adapter boundary for the legacy js/ + vendored Firebase imports used by
 * privateAiService (#2066). Bindings re-exported as-is so existing js/* test
 * mocks apply via the @legacy alias; SDK shapes stay loose.
 */
export const getUserProfile = legacyGetUserProfile as (...args: any[]) => Promise<any>;
export const db: unknown = legacyDb;
export const addDoc = legacyAddDoc as (...args: any[]) => Promise<any>;
export const collection = legacyCollection as (...args: any[]) => any;
export const doc = legacyDoc as (...args: any[]) => any;
export const getDocs = legacyGetDocs as (...args: any[]) => Promise<any>;
export const limit = legacyLimit as (...args: any[]) => any;
export const orderBy = legacyOrderBy as (...args: any[]) => any;
export const query = legacyQuery as (...args: any[]) => any;
export const serverTimestamp = legacyServerTimestamp as (...args: any[]) => any;
export const setDoc = legacySetDoc as (...args: any[]) => Promise<any>;
export const getApp = legacyGetApp as (name?: string) => unknown;
export const getAI = legacyGetAI as (app: unknown, options?: Record<string, unknown>) => unknown;
export const getGenerativeModel = legacyGetGenerativeModel as (ai: unknown, options: Record<string, unknown>) => {
  generateContent: (...args: any[]) => Promise<any>;
};
export const GoogleAIBackend = LegacyGoogleAIBackend as new (...args: any[]) => unknown;
