import { getApp as legacyGetApp } from '@legacy/vendor/firebase-app.js';
import { getAI as legacyGetAI, getGenerativeModel as legacyGetGenerativeModel, GoogleAIBackend as LegacyGoogleAIBackend } from '@legacy/vendor/firebase-ai.js';

export const getApp = legacyGetApp as (...args: any[]) => any;
export const getAI = legacyGetAI as (...args: any[]) => any;
export const getGenerativeModel = legacyGetGenerativeModel as (...args: any[]) => any;
export const GoogleAIBackend = LegacyGoogleAIBackend as new (...args: any[]) => unknown;
