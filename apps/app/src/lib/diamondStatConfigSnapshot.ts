import { hashDiamondValue } from './diamondScorebook/canonical';
import {
  DIAMOND_PLAYER_STAT_CATALOG,
  DIAMOND_TEAM_STAT_CATALOG
} from './adapters/legacyDiamondStatPresentation';

const DIAMOND_STAT_CONFIG_SNAPSHOT_SCHEMA_VERSION = 2;
const MAX_DIAMOND_STAT_DEFINITIONS = 256;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_STAT_ID_PATTERN = /^[a-z0-9][a-z0-9_]{0,63}$/;
const BLOCKED_STAT_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const STAT_SCOPES = new Set(['player', 'team']);
const STAT_VISIBILITIES = new Set(['public', 'private']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function containsAsciiControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function isExactResourceId(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 1
    && value.length <= 128
    && !value.includes('/')
    && !containsAsciiControlCharacter(value);
}

function isExactStatId(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && SAFE_STAT_ID_PATTERN.test(value)
    && !BLOCKED_STAT_IDS.has(value);
}

function canonicalStatIdList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_DIAMOND_STAT_DEFINITIONS) return null;
  if (value.some((entry) => !isExactStatId(entry))) return null;
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) return null;
  return [...ids].sort();
}

function canonicalDefinitions(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_DIAMOND_STAT_DEFINITIONS) return null;
  const definitions: Array<{ id: string; scope: 'player' | 'team'; visibility: 'public' | 'private' }> = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!isPlainObject(candidate) || !isExactStatId(candidate.id) || seen.has(candidate.id)) return null;
    if (
      typeof candidate.scope !== 'string'
      || !STAT_SCOPES.has(candidate.scope)
      || typeof candidate.visibility !== 'string'
      || !STAT_VISIBILITIES.has(candidate.visibility)
    ) return null;
    seen.add(candidate.id);
    definitions.push({
      id: candidate.id,
      scope: candidate.scope as 'player' | 'team',
      visibility: candidate.visibility as 'public' | 'private'
    });
  }
  return definitions.sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ));
}

function safePresentationOverrides(value: Record<string, unknown>) {
  const overrides: Record<string, unknown> = {};
  (['label', 'acronym', 'group'] as const).forEach((field) => {
    const candidate = value[field];
    if (
      typeof candidate === 'string'
      && candidate === candidate.trim()
      && candidate.length >= 1
      && candidate.length <= 160
    ) overrides[field] = candidate;
  });
  if (value.format === 'number' || value.format === 'percentage') overrides.format = value.format;
  if (Number.isSafeInteger(value.precision) && Number(value.precision) >= 0 && Number(value.precision) <= 6) {
    overrides.precision = value.precision;
  }
  if (value.rankingOrder === 'asc' || value.rankingOrder === 'desc') overrides.rankingOrder = value.rankingOrder;
  if (typeof value.topStat === 'boolean') overrides.topStat = value.topStat;
  return overrides;
}

export function buildDiamondStatConfigSnapshotHash({
  teamId,
  configId,
  config
}: {
  teamId: unknown;
  configId: unknown;
  config: unknown;
}): string | null {
  if (!isExactResourceId(teamId) || !isExactResourceId(configId) || !isPlainObject(config)) return null;
  const statDefinitions = canonicalDefinitions(config.statDefinitions);
  const explicitPublicTeamStatIds = canonicalStatIdList(config.diamondPublicTeamStatIds ?? []);
  if (!statDefinitions || !explicitPublicTeamStatIds) return null;

  const privatePlayerStatIds = statDefinitions
    .filter((definition) => definition.scope === 'player' && definition.visibility === 'private')
    .map((definition) => definition.id);
  const publicPlayerStatIds = statDefinitions
    .filter((definition) => definition.scope === 'player' && definition.visibility === 'public')
    .map((definition) => definition.id);
  const publicTeamStatIds = [...new Set([
    ...statDefinitions
      .filter((definition) => definition.scope === 'team' && definition.visibility === 'public')
      .map((definition) => definition.id),
    ...explicitPublicTeamStatIds
  ])].sort();

  try {
    return hashDiamondValue({
      schemaVersion: DIAMOND_STAT_CONFIG_SNAPSHOT_SCHEMA_VERSION,
      teamId,
      configId,
      definitionCount: statDefinitions.length,
      statDefinitions,
      privatePlayerStatIds,
      publicPlayerStatIds,
      publicTeamStatIds
    });
  } catch {
    return null;
  }
}

export function buildActivationPinnedDiamondPresentationConfig(config: unknown): Record<string, unknown> | null {
  if (!isPlainObject(config) || !isExactResourceId(config.id)) return null;
  const statDefinitions = canonicalDefinitions(config.statDefinitions);
  const publicTeamStatIds = canonicalStatIdList(config.diamondPublicTeamStatIds ?? []);
  if (!statDefinitions || !publicTeamStatIds) return null;

  const rawDefinitionsById = new Map((config.statDefinitions as Record<string, unknown>[])
    .map((definition) => [definition.id, definition] as const));
  const pinnedDefinitionsById = new Map(statDefinitions.map((definition) => [definition.id, definition] as const));
  const fixedCatalogs = [
    ['player', DIAMOND_PLAYER_STAT_CATALOG],
    ['team', DIAMOND_TEAM_STAT_CATALOG]
  ] as const;
  const safeDefinitions = fixedCatalogs.flatMap(([scope, catalog]) => catalog.flatMap((fixedDefinition) => {
    const id = String(fixedDefinition?.id || '');
    const pinnedDefinition = pinnedDefinitionsById.get(id);
    const rawDefinition = rawDefinitionsById.get(id);
    if (!pinnedDefinition || pinnedDefinition.scope !== scope || !rawDefinition) return [];
    return [{
      ...fixedDefinition,
      ...safePresentationOverrides(rawDefinition),
      id,
      scope,
      visibility: pinnedDefinition.visibility
    }];
  }));

  return {
    ...config,
    columns: [],
    statDefinitions: safeDefinitions,
    diamondPublicTeamStatIds: publicTeamStatIds
  };
}

export function currentDiamondStatConfigMatchesActivation({
  teamId,
  game,
  config
}: {
  teamId: unknown;
  game: unknown;
  config: unknown;
}): boolean {
  if (!isPlainObject(game) || game.trackingEngine !== 'diamond-v2' || !isPlainObject(config)) return false;
  const configId = game.statTrackerConfigId;
  const configDocumentId = config.id;
  const expectedHash = game.diamondStatConfigSnapshotHash;
  if (
    !isExactResourceId(configId)
    || !isExactResourceId(configDocumentId)
    || configDocumentId !== configId
    || typeof expectedHash !== 'string'
    || !SHA256_PATTERN.test(expectedHash)
  ) return false;
  return buildDiamondStatConfigSnapshotHash({ teamId, configId, config }) === expectedHash;
}
