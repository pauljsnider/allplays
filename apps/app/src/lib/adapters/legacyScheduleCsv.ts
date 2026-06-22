import {
  SCHEDULE_CSV_IMPORT_FIELDS as legacyFields,
  buildScheduleImportPreview as legacyBuildScheduleImportPreview,
  inferScheduleCsvMapping as legacyInferScheduleCsvMapping,
  normalizeScheduleImportDraft as legacyNormalizeScheduleImportDraft,
  parseCsvText as legacyParseCsvText,
  validateScheduleCsvMapping as legacyValidateScheduleCsvMapping
} from '@legacy/schedule-csv-import.js';

/**
 * Typed adapter boundary for the legacy js/ schedule CSV import helpers (#2066).
 * Shapes stay loose (the legacy module is untyped); scheduleCsvImport layers its
 * own exported types on top.
 */
export const SCHEDULE_CSV_IMPORT_FIELDS = legacyFields as ReadonlyArray<{ key: string; label: string; [key: string]: unknown }>;

export const buildScheduleImportPreview = legacyBuildScheduleImportPreview as (...args: any[]) => any;
export const inferScheduleCsvMapping = legacyInferScheduleCsvMapping as (...args: any[]) => any;
export const normalizeScheduleImportDraft = legacyNormalizeScheduleImportDraft as (...args: any[]) => any;
export const parseCsvText = legacyParseCsvText as (text: string) => any;
export const validateScheduleCsvMapping = legacyValidateScheduleCsvMapping as (...args: any[]) => any;
