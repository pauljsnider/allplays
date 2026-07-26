import {
  getRosterAiImportFieldCatalog as legacyGetRosterAiImportFieldCatalog,
  planRosterAiImport as legacyPlanRosterAiImport,
  planRosterCsvImport as legacyPlanRosterCsvImport
} from '@legacy/roster-profile-fields.js';

/**
 * Narrow typed boundary for the roster import contract shared with legacy.
 * Firebase/service writes remain in teamDetailService.
 */
export const getRosterAiImportFieldCatalog = legacyGetRosterAiImportFieldCatalog as (
  fields?: Array<Record<string, any>>
) => Array<Record<string, any>>;

export const planRosterAiImport = legacyPlanRosterAiImport as (input: {
  aiOperations?: Array<Record<string, any>>;
  fields?: Array<Record<string, any>>;
  existingPlayers?: Array<Record<string, any>>;
  source?: string;
}) => {
  errors: string[];
  operations: Array<Record<string, any>>;
};

export const planRosterCsvImport = legacyPlanRosterCsvImport as (input: {
  csvText?: string;
  fields?: Array<Record<string, any>>;
  existingPlayers?: Array<Record<string, any>>;
}) => {
  errors: string[];
  operations: Array<Record<string, any>>;
};
