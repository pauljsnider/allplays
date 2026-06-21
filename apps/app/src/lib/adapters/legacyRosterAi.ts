import { getApp as legacyGetApp } from '@legacy/vendor/firebase-app.js';
import { getAI as legacyGetAI, getGenerativeModel as legacyGetGenerativeModel, GoogleAIBackend as LegacyGoogleAIBackend, Schema as LegacySchema } from '@legacy/vendor/firebase-ai.js';

/**
 * Typed adapter boundary for the vendored Firebase AI SDK used by rosterAiImport
 * (#2066). Bindings re-exported as-is so existing js/vendor test mocks apply via
 * the @legacy alias; SDK shapes stay loose.
 */
export const getApp = legacyGetApp as (name?: string) => unknown;
export const getAI = legacyGetAI as (app: unknown, options?: Record<string, unknown>) => unknown;
export const getGenerativeModel = legacyGetGenerativeModel as (ai: unknown, options: Record<string, unknown>) => {
  generateContent: (...args: any[]) => Promise<any>;
};
export const GoogleAIBackend = LegacyGoogleAIBackend as new (...args: any[]) => unknown;
export const Schema = LegacySchema as any;
