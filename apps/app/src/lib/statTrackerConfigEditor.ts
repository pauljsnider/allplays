import { getStatConfigPresetById, getStatConfigPresetOptions } from '../../../../js/stat-config-presets.js';
import { normalizeStatTrackerConfig } from '../../../../js/stat-leaderboards.js';

type LegacyStatTrackerConfig = {
  id?: string;
  name?: string;
  baseType?: string;
  columns?: string[];
  statDefinitions?: Array<Record<string, unknown>>;
};

type StatConfigPresetOption = {
  id: string;
  label: string;
  description: string;
  baseType: string;
};

export type StatTrackerConfigColumnDraft = {
  uiId: string;
  key: string;
  label: string;
  definition: Record<string, unknown>;
};

export type StatTrackerConfigDraft = {
  id?: string;
  name: string;
  baseType: string;
  columns: StatTrackerConfigColumnDraft[];
  preservedStatDefinitions: Array<Record<string, unknown>>;
};

export type StatTrackerConfigPayload = {
  name: string;
  baseType: string;
  columns: string[];
  statDefinitions: Array<Record<string, unknown>>;
};

export type StatTrackerConfigDraftValidation = {
  valid: boolean;
  errors: string[];
};

let nextDraftColumnId = 0;

function createColumnUiId() {
  nextDraftColumnId += 1;
  return `stat-col-${nextDraftColumnId}`;
}

function normalizeColumnKey(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '');
}

function normalizeColumnLabel(value: string, fallback = 'Stat') {
  const trimmed = String(value || '').trim();
  return trimmed || fallback;
}

function buildColumnDefinitionTemplate(definition: Record<string, unknown> = {}, fallbackKey = '', fallbackLabel = '') {
  const label = normalizeColumnLabel(
    String(definition.label || definition.acronym || fallbackLabel || fallbackKey || 'Stat'),
    fallbackLabel || fallbackKey || 'Stat'
  );
  const key = normalizeColumnKey(String(definition.id || fallbackKey || label));
  return {
    ...definition,
    id: key,
    label,
    acronym: label,
    formula: null,
    type: 'base'
  };
}

export function createStatTrackerConfigDraft(config: LegacyStatTrackerConfig | null = null): StatTrackerConfigDraft {
  const normalized = normalizeStatTrackerConfig(config || {}) as LegacyStatTrackerConfig;
  const normalizedColumns = Array.isArray(normalized.columns) ? normalized.columns : [];
  const normalizedDefinitions = Array.isArray(normalized.statDefinitions) ? normalized.statDefinitions : [];
  const columnIds = new Set(normalizedColumns.map((column: string) => normalizeColumnKey(column)));
  const definitionsById = new Map(normalizedDefinitions.map((definition: Record<string, unknown>) => [String(definition.id || ''), definition]));

  const columns = normalizedColumns.map((column: string) => {
    const key = normalizeColumnKey(column);
    const definition = buildColumnDefinitionTemplate(definitionsById.get(key) || {}, key, String(column));
    return {
      uiId: createColumnUiId(),
      key: String(column || '').trim(),
      label: String(definition.label || column || '').trim(),
      definition
    };
  });

  const preservedStatDefinitions = normalizedDefinitions
    .filter((definition: Record<string, unknown>) => {
      const definitionId = normalizeColumnKey(String(definition.id || ''));
      if (!definitionId) return false;
      if (String(definition.formula || '').trim()) return true;
      return !columnIds.has(definitionId);
    })
    .map((definition: Record<string, unknown>) => ({ ...definition }));

  return {
    id: config?.id ? String(config.id) : undefined,
    name: String(normalized.name || ''),
    baseType: String(normalized.baseType || 'Custom'),
    columns,
    preservedStatDefinitions
  };
}

export function createEmptyStatTrackerConfigDraft() {
  return createStatTrackerConfigDraft({
    name: '',
    baseType: 'Custom',
    columns: [],
    statDefinitions: []
  });
}

export function createStatTrackerConfigDraftFromPreset(presetId: string) {
  const preset = getStatConfigPresetById(presetId) as LegacyStatTrackerConfig | null;
  return createStatTrackerConfigDraft(preset || null);
}

export function getStatTrackerConfigPresetCatalog(): StatConfigPresetOption[] {
  return getStatConfigPresetOptions() as StatConfigPresetOption[];
}

export function createBlankStatTrackerConfigColumnDraft() {
  return {
    uiId: createColumnUiId(),
    key: '',
    label: '',
    definition: buildColumnDefinitionTemplate()
  };
}

export function buildStatTrackerConfigPayload(draft: StatTrackerConfigDraft): StatTrackerConfigPayload {
  const normalizedColumns = draft.columns
    .map((column) => {
      const key = String(column.key || '').trim();
      const normalizedKey = normalizeColumnKey(key || column.label);
      const label = normalizeColumnLabel(column.label, key || 'Stat');
      if (!normalizedKey) return null;
      return {
        key,
        normalizedKey,
        label,
        definition: buildColumnDefinitionTemplate(column.definition || {}, normalizedKey, label)
      };
    })
    .filter(Boolean) as Array<{ key: string; normalizedKey: string; label: string; definition: Record<string, unknown> }>;

  return {
    name: String(draft.name || '').trim(),
    baseType: String(draft.baseType || 'Custom').trim() || 'Custom',
    columns: normalizedColumns.map((column) => column.label),
    statDefinitions: [
      ...normalizedColumns.map((column) => ({
        ...column.definition,
        id: column.normalizedKey,
        label: column.label,
        acronym: column.label,
        formula: null,
        type: 'base'
      })),
      ...(draft.preservedStatDefinitions || []).map((definition) => ({ ...definition }))
    ]
  };
}

export function validateStatTrackerConfigDraft(draft: StatTrackerConfigDraft): StatTrackerConfigDraftValidation {
  const errors: string[] = [];
  if (!String(draft.name || '').trim()) {
    errors.push('Please add a config name.');
  }

  const normalizedKeys = draft.columns
    .map((column) => normalizeColumnKey(String(column.key || '').trim() || String(column.label || '').trim()))
    .filter(Boolean);

  if (!normalizedKeys.length) {
    errors.push('Please add at least one column.');
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  normalizedKeys.forEach((key) => {
    if (seen.has(key)) {
      duplicates.add(key);
      return;
    }
    seen.add(key);
  });

  if (duplicates.size > 0) {
    errors.push('Column keys must be unique.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

