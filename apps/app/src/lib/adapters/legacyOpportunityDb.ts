import {
  functions as legacyFunctions,
  httpsCallable as legacyHttpsCallable
} from '@legacy/firebase.js';

export const functions: unknown = legacyFunctions;
export const httpsCallable = legacyHttpsCallable as (...args: any[]) => (...callArgs: any[]) => Promise<any>;
