import { getConfigs as legacyGetConfigs, getGame as legacyGetGame, getGameEvents as legacyGetGameEvents, getTeam as legacyGetTeam } from '@legacy/db.js';
import { buildGameSummaryPrompt as legacyBuildGameSummaryPrompt, buildPracticeFeedPrompt as legacyBuildPracticeFeedPrompt, buildFinishGamePayload as legacyBuildFinishGamePayload } from '@legacy/game-day-wrapup.js';
import { resolveLiveStatConfig as legacyResolveLiveStatConfig } from '@legacy/live-game-state.js';
import { resolveSummaryRecipient as legacyResolveSummaryRecipient } from '@legacy/live-tracker-email.js';
import { getApp as legacyGetApp } from '@legacy/vendor/firebase-app.js';
import { getAI as legacyGetAI, getGenerativeModel as legacyGetGenerativeModel, GoogleAIBackend as LegacyGoogleAIBackend } from '@legacy/vendor/firebase-ai.js';

/**
 * Typed adapter boundary for the legacy js/ game wrap-up helpers (#2066). Bindings
 * re-exported as-is so existing js/* test mocks apply via the @legacy alias.
 */
export const getConfigs = legacyGetConfigs as (...args: any[]) => Promise<any>;
export const getGame = legacyGetGame as (...args: any[]) => Promise<any>;
export const getGameEvents = legacyGetGameEvents as (...args: any[]) => Promise<any>;
export const getTeam = legacyGetTeam as (...args: any[]) => Promise<any>;
export const buildGameSummaryPrompt = legacyBuildGameSummaryPrompt as (...args: any[]) => any;
export const buildPracticeFeedPrompt = legacyBuildPracticeFeedPrompt as (...args: any[]) => any;
export const buildFinishGamePayload = legacyBuildFinishGamePayload as (...args: any[]) => any;
export const resolveLiveStatConfig = legacyResolveLiveStatConfig as (...args: any[]) => any;
export const resolveSummaryRecipient = legacyResolveSummaryRecipient as (...args: any[]) => any;
export const getApp = legacyGetApp as (name?: string) => unknown;
export const getAI = legacyGetAI as (app: unknown, options?: Record<string, unknown>) => unknown;
export const getGenerativeModel = legacyGetGenerativeModel as (ai: unknown, options: Record<string, unknown>) => {
  generateContent: (...args: any[]) => Promise<any>;
};
export const GoogleAIBackend = LegacyGoogleAIBackend as new (...args: any[]) => unknown;
