import { getApp as legacyGetApp } from '@legacy/vendor/firebase-app.js';
import { getAI as legacyGetAI, getGenerativeModel as legacyGetGenerativeModel, GoogleAIBackend as LegacyGoogleAIBackend } from '@legacy/vendor/firebase-ai.js';
import { buildRotationPlanFromGamePlan as legacyBuildRotationPlanFromGamePlan, normalizeLineupsForGamePlanPlanner as legacyNormalizeLineupsForGamePlanPlanner } from '@legacy/game-plan-interop.js';
import { buildGamePlanIntervals as legacyBuildGamePlanIntervals } from '@legacy/game-plan-intervals.js';

/**
 * Typed adapter boundary for the legacy js/ + vendored Firebase AI imports used
 * by gameDayLineupBuilder (#2066). Bindings re-exported as-is so existing js/*
 * test mocks apply via the @legacy alias; SDK shapes stay loose.
 */
export const getApp = legacyGetApp as (name?: string) => unknown;
export const getAI = legacyGetAI as (app: unknown, options?: Record<string, unknown>) => unknown;
export const getGenerativeModel = legacyGetGenerativeModel as (ai: unknown, options: Record<string, unknown>) => {
  generateContent: (...args: any[]) => Promise<any>;
};
export const GoogleAIBackend = LegacyGoogleAIBackend as new (...args: any[]) => unknown;
export const buildRotationPlanFromGamePlan = legacyBuildRotationPlanFromGamePlan as (...args: any[]) => any;
export const normalizeLineupsForGamePlanPlanner = legacyNormalizeLineupsForGamePlanPlanner as (...args: any[]) => any;
export const buildGamePlanIntervals = legacyBuildGamePlanIntervals as (...args: any[]) => any;
