import { getConfigs as legacyGetConfigs, getGame as legacyGetGame, getPlayers as legacyGetPlayers, getTeam as legacyGetTeam, uploadStatSheetPhoto as legacyUploadStatSheetPhoto } from '@legacy/db.js';
import { collection as legacyCollection, db as legacyDb, deleteDoc as legacyDeleteDoc, doc as legacyDoc, getDocs as legacyGetDocs, writeBatch as legacyWriteBatch } from '@legacy/firebase.js';
import { buildTrackStatsheetApplyPlan as legacyBuildTrackStatsheetApplyPlan, validateTrackStatsheetApplyRows as legacyValidateTrackStatsheetApplyRows } from '@legacy/track-statsheet-apply.js';
import { addAggregatedStatsWritesToBatch as legacyAddAggregatedStatsWritesToBatch } from '@legacy/live-tracker-save-complete.js';
import { getApp as legacyGetApp } from '@legacy/vendor/firebase-app.js';
import { getAI as legacyGetAI, getGenerativeModel as legacyGetGenerativeModel, GoogleAIBackend as LegacyGoogleAIBackend, Schema as LegacySchema } from '@legacy/vendor/firebase-ai.js';

/**
 * Typed adapter boundary for the legacy js/ + vendored Firebase imports used by
 * statsheetImportService (#2066). Bindings re-exported as-is so existing js/*
 * test mocks apply via the @legacy alias; SDK shapes stay loose.
 */
export const getConfigs = legacyGetConfigs as (...args: any[]) => Promise<any>
export const getGame = legacyGetGame as (...args: any[]) => Promise<any>
export const getPlayers = legacyGetPlayers as (...args: any[]) => Promise<any>
export const getTeam = legacyGetTeam as (...args: any[]) => Promise<any>
export const uploadStatSheetPhoto = legacyUploadStatSheetPhoto as (...args: any[]) => Promise<any>
export const collection = legacyCollection as (...args: any[]) => any
export const db: unknown = legacyDb
export const deleteDoc = legacyDeleteDoc as (...args: any[]) => Promise<any>
export const doc = legacyDoc as (...args: any[]) => any
export const getDocs = legacyGetDocs as (...args: any[]) => Promise<any>
export const writeBatch = legacyWriteBatch as (...args: any[]) => any
export const buildTrackStatsheetApplyPlan = legacyBuildTrackStatsheetApplyPlan as (...args: any[]) => any
export const validateTrackStatsheetApplyRows = legacyValidateTrackStatsheetApplyRows as (...args: any[]) => any
export const addAggregatedStatsWritesToBatch = legacyAddAggregatedStatsWritesToBatch as (...args: any[]) => any
export const getApp = legacyGetApp as (name?: string) => unknown
export const getAI = legacyGetAI as (app: unknown, options?: Record<string, unknown>) => unknown
export const getGenerativeModel = legacyGetGenerativeModel as (ai: unknown, options: Record<string, unknown>) => { generateContent: (...args: any[]) => Promise<any> }
export const GoogleAIBackend = LegacyGoogleAIBackend as new (...args: any[]) => unknown
export const Schema = LegacySchema as any
