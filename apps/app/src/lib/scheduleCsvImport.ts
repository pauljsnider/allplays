import {
  SCHEDULE_CSV_IMPORT_FIELDS,
  buildScheduleImportPreview,
  inferScheduleCsvMapping,
  normalizeScheduleImportDraft,
  parseCsvText,
  validateScheduleCsvMapping
} from './adapters/legacyScheduleCsv';

export type ScheduleCsvImportFieldKey = 'startDateTime' | 'date' | 'startTime' | 'endTime' | 'eventType' | 'opponent' | 'title' | 'location' | 'arrivalTime' | 'isHome' | 'notes';
export type ScheduleCsvImportMapping = Partial<Record<ScheduleCsvImportFieldKey, string>>;
export type ScheduleCsvImportNormalizedRow = {
  rowNumber: number;
  eventType: 'game' | 'practice';
  startsAt: string;
  endsAt: string | null;
  opponent: string | null;
  title: string | null;
  location: string | null;
  arrivalTime: string | null;
  isHome: boolean | null;
  notes: string | null;
};
export type ScheduleCsvImportPreviewRow = {
  rowNumber: number;
  draft: Record<string, string>;
  normalized: ScheduleCsvImportNormalizedRow;
  errors: string[];
};

export {
  SCHEDULE_CSV_IMPORT_FIELDS,
  buildScheduleImportPreview,
  inferScheduleCsvMapping,
  normalizeScheduleImportDraft,
  parseCsvText,
  validateScheduleCsvMapping
};
