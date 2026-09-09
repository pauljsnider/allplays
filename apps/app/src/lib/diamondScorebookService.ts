import { App as CapacitorApp } from '@capacitor/app';
import { functions, httpsCallable } from './adapters/legacyParentTools';
import {
  getDiamondRulesProfile,
  type DiamondDefensivePosition,
  type DiamondFinalizationReason,
  type DiamondGameEndDecision,
  type DiamondHalfInningEnd,
  type DiamondPitchResult
} from './diamondScorebook';
import {
  normalizeDiamondAiDraftForPublication,
  normalizeDiamondAiSourcePacket,
  type DiamondAiGameDraft,
  type DiamondAiSourcePacket
} from './diamondScorebookAi';
import { callNativeFirebaseFunction } from './nativeCallable';
import { isNativeRuntime } from './nativeRuntime';

export type DiamondSport = 'baseball' | 'fastpitch';
export type DiamondCaptureMode = 'quick' | 'full';
export type DiamondHalf = 'top' | 'bottom';
export type DiamondLastPitchResult = Exclude<DiamondPitchResult, 'balk' | 'pickoff_attempt'>;
export type DiamondCoverageStatus = 'complete' | 'partial' | 'not_collected';
export type DiamondLifecycle = 'configured' | 'ready' | 'active' | 'suspended' | 'final' | 'correction' | 'cancelled';

export type DiamondCommandType =
  | 'activate'
  | 'set_lineup'
  | 'set_defensive_alignment'
  | 'set_dp_flex'
  | 'start'
  | 'record_pitch'
  | 'record_plate_appearance'
  | 'advance_runner'
  | 'record_fielding'
  | 'record_scoring_judgment'
  | 'advance_half_inning'
  | 'place_tiebreaker_runner'
  | 'substitute'
  | 're_enter'
  | 'add_courtesy_runner'
  | 'scorer_handoff'
  | 'private_note'
  | 'suspend'
  | 'resume'
  | 'rules_decision'
  | 'void_event'
  | 'supersede_event'
  | 'reopen_for_correction'
  | 'finalize'
  | 'cancel';

export type DiamondJsonValue = string | number | boolean | null | DiamondJsonValue[] | { [key: string]: DiamondJsonValue };
export type DiamondJsonObject = { [key: string]: DiamondJsonValue };

export type DiamondPlayerRef = {
  playerId: string;
  name: string;
  number?: string | null;
};

export type DiamondBaseState = {
  first: DiamondRunnerRef | null;
  second: DiamondRunnerRef | null;
  third: DiamondRunnerRef | null;
};

export type DiamondRunnerRef = DiamondPlayerRef & {
  responsiblePitcherId: string | null;
  courtesyForPlayerId: string | null;
  reachedOnEventId: string | null;
};

export type DiamondLineupEntry = DiamondPlayerRef & {
  slot: number;
  active?: boolean;
  battingRole?: string | null;
  starterPlayerId?: string | null;
  starterReentriesUsed?: number;
  substitutions?: string[];
};

export type DiamondDefense = Partial<Record<DiamondDefensivePosition, DiamondPlayerRef>>;

export type DiamondSide = 'home' | 'away';

export type DiamondRuleCapabilities = {
  dpFlex: boolean;
  courtesyRunner: { pitcher: boolean; catcher: boolean };
};

/**
 * Optional private projection fields accepted from getDiamondState. The server
 * remains authoritative for access; these candidates are bounded display data
 * and never grant a player permission to score.
 */
export type DiamondScorebookPresentation = {
  managedSide?: DiamondSide | null;
  availablePlayers?: Partial<Record<DiamondSide, DiamondPlayerRef[]>>;
  rosterCandidates?: Partial<Record<DiamondSide, DiamondPlayerRef[]>> | Array<DiamondPlayerRef & { side: DiamondSide }>;
  rulesCapabilities?: Partial<{
    dpFlex: boolean | { enabled?: boolean };
    courtesyRunner: Partial<{ pitcher: boolean; catcher: boolean }>;
  }>;
};

export type DiamondRecentPlay = {
  eventId: string;
  revision: number;
  label: string;
  inningLabel: string;
  createdAt?: string | null;
  voided?: boolean;
  type?: DiamondCommandType | null;
};

export type DiamondPrivateEvent = {
  eventId: string;
  sequence: number;
  revision: number;
  type: DiamondCommandType;
  payload: DiamondJsonObject;
  createdAt: string | null;
  voidsEventId: string | null;
  supersedesEventId: string | null;
};

/**
 * A verified contiguous slice of manager-private command summaries. A window
 * can reach the authoritative head without containing the beginning of the
 * ledger, so head and whole-history completeness are deliberately separate.
 */
export type DiamondPrivateHistoryWindow = {
  sourceRevision: number;
  oldestSequence: number | null;
  newestSequence: number | null;
  contiguous: true;
  rangeComplete: true;
  headComplete: boolean;
  historyComplete: boolean;
  hasOlder: boolean;
  items: DiamondPrivateEvent[];
};

export type DiamondCompletenessEvidence = {
  status: DiamondCoverageStatus;
  authoritativeRevision: number;
  families: Record<string, DiamondCoverageStatus>;
  omissions: string[];
};

export type DiamondScorerLease = {
  status: 'owned' | 'held-by-other' | 'available' | 'expired' | 'unavailable';
  canScore: boolean;
  canAcquire: boolean;
  canRecover: boolean;
  holderUid: string | null;
  holderName: string | null;
  leaseId: string | null;
  epoch: number | null;
  expiresAt: string | null;
  eligibleScorers: DiamondPlayerRef[];
};

export type DiamondScorebookSnapshot = {
  schemaVersion: 2;
  teamId: string;
  gameId: string;
  instanceId: string;
  revision: number;
  checkpointHash: string;
  authoritative: boolean;
  lifecycle: DiamondLifecycle;
  captureMode: DiamondCaptureMode;
  rulesProfileId: string;
  rulesProfileVersion: number;
  teamName: string;
  opponentName: string;
  homeName: string;
  awayName: string;
  score: { home: number; away: number };
  currentHalfRuns: number | null;
  lastPitchResult: DiamondLastPitchResult | null;
  inning: {
    number: number;
    half: DiamondHalf;
    outs: number;
    balls: number;
    strikes: number;
    pitchesInPlateAppearance: number;
  };
  bases: DiamondBaseState;
  currentBatter: DiamondPlayerRef | null;
  currentPitcher: DiamondPlayerRef | null;
  lineups: Record<DiamondSide, DiamondLineupEntry[]>;
  courtesyRunnerIds?: Record<DiamondSide, string[]>;
  defense: Record<DiamondSide, DiamondDefense>;
  nextBatterSlot: Record<DiamondSide, number>;
  battingLineup: DiamondLineupEntry[];
  defensiveLineup: DiamondPlayerRef[];
  availablePlayers: Record<DiamondSide, DiamondPlayerRef[]>;
  managedSide: DiamondSide | null;
  ruleCapabilities: DiamondRuleCapabilities;
  halfInningEnd: DiamondHalfInningEnd | null;
  gameEndDecision: DiamondGameEndDecision | null;
  finalizationReason: DiamondFinalizationReason | null;
  recentPlays: DiamondRecentPlay[];
  lease: DiamondScorerLease;
  completeness: DiamondCompletenessEvidence;
  readOnlyReason: string | null;
};

export type DiamondCommandEnvelope = {
  schemaVersion: 2;
  commandId: string;
  teamId: string;
  gameId: string;
  appBuild: number;
  expectedInstanceId: string;
  leaseId?: string;
  expectedRevision: number;
  rulesProfileId: string;
  rulesProfileVersion: number;
  type: DiamondCommandType;
  payload: DiamondJsonObject;
};

export type DiamondCommandOutcome = {
  outcome: 'accepted' | 'duplicate';
  revision: number;
  eventId: string | null;
  snapshot: DiamondScorebookSnapshot | null;
  completeness: DiamondCompletenessEvidence;
};

export type DiamondScorerLeaseOutcome = {
  outcome: 'accepted' | 'duplicate';
  operation: 'acquire' | 'recover';
  revision: number;
  eventId: string | null;
  snapshot: DiamondScorebookSnapshot;
};

export type DiamondScorerCandidateList = {
  schemaVersion: 1;
  complete: true;
  teamId: string;
  gameId: string;
  instanceId: string;
  revision: number;
  leaseId: string;
  candidates: DiamondPlayerRef[];
};

export type DiamondVoiceProposal = {
  schemaVersion: 1;
  type: DiamondCommandType;
  payload: DiamondJsonObject;
  confidence: number;
  unresolvedFields: string[];
  requiresConfirmation: true;
  mutatesState: false;
};

export type DiamondAccess = {
  eligible: boolean;
  canManage: boolean;
  canScore: boolean;
  policyMode: 'disabled' | 'internal' | 'pilot' | 'enabled';
  sport: DiamondSport | null;
  teamOptIn: boolean;
  trackingEngine: 'diamond-v2' | 'legacy' | null;
  reason: string | null;
};

export type DiamondTeamConfiguration = {
  configured: boolean;
  enabled: boolean;
  teamId: string;
  sport: DiamondSport;
  rulesProfileId: string;
  rulesProfileVersion: number;
  captureMode: DiamondCaptureMode;
};

export type DiamondGameActivation = {
  activated: boolean;
  teamId: string;
  gameId: string;
  trackingEngine: 'diamond-v2';
  snapshot: DiamondScorebookSnapshot | null;
};

export type DiamondRecapSource = {
  current: true;
  sourceRevision: number;
  checkpointHash: string;
  packet: DiamondAiSourcePacket;
};

export type DiamondAiPublicationEvidence = {
  published: true;
  current: true;
  sourceRevision: number;
  checkpointHash: string;
  publicationId: string;
  publishedAt: string;
};

export type DiamondScorebookErrorCode =
  | 'invalid-input'
  | 'invalid-response'
  | 'secure-randomness-unavailable'
  | 'permission-denied'
  | 'not-found'
  | 'stale-revision'
  | 'conflict'
  | 'offline'
  | 'unavailable'
  | 'rate-limited'
  | 'rejected'
  | 'storage-unavailable';

export class DiamondScorebookError extends Error {
  readonly code: DiamondScorebookErrorCode;
  readonly retryable: boolean;
  readonly authoritativeRevision: number | null;

  constructor(
    code: DiamondScorebookErrorCode,
    message: string,
    options: { retryable?: boolean; authoritativeRevision?: number | null; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'DiamondScorebookError';
    this.code = code;
    this.retryable = options.retryable === true;
    this.authoritativeRevision = normalizeOptionalRevision(options.authoritativeRevision);
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export type DiamondCallableTransport = {
  call: <T>(name: string, data: Record<string, unknown>) => Promise<T>;
};

export type DiamondAppBuildResolver = () => Promise<number>;

export type DiamondAppBuildDependencies = {
  isNative?: () => boolean;
  getNativeInfo?: () => Promise<{ build?: unknown }>;
  webBuild?: unknown;
};

export type DiamondQueuedCommand = {
  command: DiamondCommandEnvelope;
  queuedAt: string;
  authenticatedUid: string;
  scorerUid: string;
  instanceId: string;
  leaseId: string;
};

export type DiamondQueueIdentity = {
  teamId: string;
  gameId: string;
  authenticatedUid: string;
  scorerUid: string;
  instanceId: string;
  leaseId: string;
};

export type DiamondQueueReconciliation = {
  accepted: number;
  duplicates: number;
  remaining: DiamondQueuedCommand[];
  lastSnapshot: DiamondScorebookSnapshot | null;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SecureCrypto = Partial<Pick<Crypto, 'getRandomValues' | 'randomUUID'>>;

const diamondCommandTypes = new Set<DiamondCommandType>([
  'activate',
  'set_lineup',
  'set_defensive_alignment',
  'set_dp_flex',
  'start',
  'record_pitch',
  'record_plate_appearance',
  'advance_runner',
  'record_fielding',
  'record_scoring_judgment',
  'advance_half_inning',
  'place_tiebreaker_runner',
  'substitute',
  're_enter',
  'add_courtesy_runner',
  'scorer_handoff',
  'private_note',
  'suspend',
  'resume',
  'rules_decision',
  'void_event',
  'supersede_event',
  'reopen_for_correction',
  'finalize',
  'cancel'
]);
const voiceProposalCommandTypes = new Set<DiamondCommandType>([
  'record_pitch',
  'record_plate_appearance',
  'advance_runner',
  'record_fielding',
  'record_scoring_judgment',
  'advance_half_inning',
  'place_tiebreaker_runner',
  'substitute',
  're_enter',
  'add_courtesy_runner'
]);

const queueVersion = 3;
const queuePrefix = 'allplays:diamond-scorebook:queue:v3';
const legacyQueuePrefixes = ['allplays:diamond-scorebook:queue:v1', 'allplays:diamond-scorebook:queue:v2'];
const maxQueueCommands = 2000;
const maxQueueBytes = 2_000_000;
const maxPrivateEventPageBytes = 1_000_000;
const maxScorerCandidates = 100;
const defaultPrivateHistoryWindowEvents = 200;
const maxPrivateHistoryWindowEvents = 200;
const maxPrivateHistoryWindowBytes = 16_000_000;
const scorerCandidateNativeTimeoutMs = 125_000;
const scorerCandidateRetryHandleRetentionMs = 8 * 60 * 1000;
const maxScorerCandidateRetryHandles = 32;
const retryableCallableCodes = new Set(['deadline-exceeded', 'internal', 'network-request-failed', 'unavailable', 'unknown']);

type ScorerCandidateRetryHandle = {
  requestId: string;
  expiresAtMs: number;
};

const scorerCandidateRetryHandles = new Map<string, ScorerCandidateRetryHandle>();
let scorerCandidateRetryPrincipal: string | null = null;

function compactText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function requireResponseRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new DiamondScorebookError('invalid-response', `The ${label} response was malformed.`);
  }
  return value as Record<string, unknown>;
}

function requireExactResponseFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw new DiamondScorebookError('invalid-response', `The ${label} response contained an unsupported field.`);
  }
}

function serializedUtf8Bytes(value: unknown, label: string) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new DiamondScorebookError('invalid-response', `The ${label} response was not valid bounded JSON.`);
  }
}

function requireResourceId(value: unknown, label: string) {
  const normalized = compactText(value);
  if (!normalized || normalized.length > 128 || normalized.includes('/')) {
    throw new DiamondScorebookError('invalid-input', `${label} is missing or invalid.`);
  }
  return normalized;
}

function containsAsciiControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function requireResponseResourceId(value: unknown, label: string) {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.length > 128 ||
    value.includes('/') ||
    containsAsciiControlCharacter(value)
  ) {
    throw new DiamondScorebookError('invalid-response', `The ${label} was missing or invalid.`);
  }
  return value;
}

function requireScorerCandidateName(value: unknown) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 160 || containsAsciiControlCharacter(value)) {
    throw new DiamondScorebookError('invalid-response', 'A scorer candidate name was missing or invalid.');
  }
  return value;
}

function requireRevision(value: unknown, label = 'Expected revision') {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new DiamondScorebookError('invalid-input', `${label} must be a nonnegative integer.`);
  }
  return revision;
}

function requireAppBuild(value: unknown) {
  const candidate = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!Number.isSafeInteger(candidate) || Number(candidate) < 1) {
    throw new DiamondScorebookError(
      'invalid-input',
      'This app does not expose a valid build number. Diamond scoring remains read only until the app is updated or rebuilt.'
    );
  }
  return Number(candidate);
}

/**
 * Resolve a server-comparable build number without inventing a fallback.
 * Native shells use the platform build; hosted web must inject an explicit
 * VITE_ALLPLAYS_APP_BUILD at compile time. Tests can inject either source.
 */
export async function resolveDiamondAppBuild(dependencies: DiamondAppBuildDependencies = {}) {
  const native = (dependencies.isNative || isNativeRuntime)();
  if (!native) {
    return requireAppBuild(dependencies.webBuild ?? import.meta.env.VITE_ALLPLAYS_APP_BUILD);
  }
  try {
    const info = await (dependencies.getNativeInfo || (() => CapacitorApp.getInfo()))();
    return requireAppBuild(info.build);
  } catch (error) {
    if (error instanceof DiamondScorebookError) throw error;
    throw new DiamondScorebookError('unavailable', 'The native app build could not be verified. Diamond scoring remains read only.', {
      cause: error
    });
  }
}

async function resolveRequestedAppBuild(value: unknown, resolver?: DiamondAppBuildResolver) {
  if (value !== undefined) return requireAppBuild(value);
  try {
    return requireAppBuild(await (resolver || resolveDiamondAppBuild)());
  } catch (error) {
    if (error instanceof DiamondScorebookError) throw error;
    throw new DiamondScorebookError('unavailable', 'The app build could not be verified. Diamond scoring remains read only.', {
      cause: error
    });
  }
}

function requireCheckpointHash(value: unknown, code: 'invalid-input' | 'invalid-response' = 'invalid-response') {
  const hash = compactText(value).toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(hash)) {
    throw new DiamondScorebookError(
      code,
      code === 'invalid-input'
        ? 'The Diamond AI request did not include a valid checkpoint hash.'
        : 'The Diamond AI response did not include a valid checkpoint hash.'
    );
  }
  return hash;
}

function requireSecureRequestId(value: unknown) {
  const requestId = requireResourceId(value, 'Request ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new DiamondScorebookError('invalid-input', 'Request ID must be a secure UUID.');
  }
  return requestId.toLowerCase();
}

function requireScorerLeaseId(value: unknown) {
  const leaseId = requireResourceId(value, 'Scorer lease ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leaseId)) {
    throw new DiamondScorebookError('invalid-input', 'Scorer lease ID must be a secure UUID.');
  }
  return leaseId.toLowerCase();
}

function requireDiamondInstanceId(value: unknown, code: 'invalid-input' | 'invalid-response') {
  const instanceId = compactText(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(instanceId)) {
    throw new DiamondScorebookError(code, 'Diamond instance ID must be a secure UUID.');
  }
  return instanceId.toLowerCase();
}

function requireIsoTimestamp(value: unknown) {
  const timestamp = compactText(value);
  if (
    !timestamp ||
    timestamp.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    throw new DiamondScorebookError('invalid-response', 'The Diamond AI publication did not include a valid publication time.');
  }
  return timestamp;
}

function requirePublicationId(value: unknown) {
  const publicationId = compactText(value);
  if (!publicationId || publicationId.length > 128 || publicationId.includes('/')) {
    throw new DiamondScorebookError('invalid-response', 'The Diamond AI publication did not include a safe publication ID.');
  }
  return publicationId;
}

function requireExactResponseKeys(source: Record<string, unknown>, keys: readonly string[], label: string) {
  const expected = new Set(keys);
  const unknown = Object.keys(source).find((key) => !expected.has(key));
  const missing = keys.find((key) => !Object.prototype.hasOwnProperty.call(source, key));
  if (unknown || missing) {
    throw new DiamondScorebookError('invalid-response', `${label} did not match the expected response contract.`);
  }
}

function requirePositiveVersion(value: unknown, label = 'Rules profile version') {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new DiamondScorebookError('invalid-input', `${label} must be a positive integer.`);
  }
  return version;
}

function normalizeOptionalRevision(value: unknown) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function normalizeNonnegative(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeBoundedInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

const diamondLastPitchResults = new Set<DiamondLastPitchResult>([
  'ball',
  'called_strike',
  'swinging_strike',
  'foul',
  'foul_bunt',
  'in_play',
  'hit_by_pitch',
  'catcher_interference',
  'illegal_pitch'
]);

function normalizeCurrentHalfRuns(value: unknown, inningKey: string): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const source = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(source, inningKey)) return 0;
  const runs = source[inningKey];
  return Number.isSafeInteger(runs) && Number(runs) >= 0 ? Number(runs) : null;
}

function normalizeLastPitchResult(value: Record<string, unknown>): DiamondLastPitchResult | null {
  if (!Object.prototype.hasOwnProperty.call(value, 'lastPitchResult')) {
    throw new DiamondScorebookError('invalid-response', 'The scorebook did not include its authoritative last delivered pitch result.');
  }
  const result = value.lastPitchResult;
  if (result === null) return null;
  if (typeof result === 'string' && diamondLastPitchResults.has(result as DiamondLastPitchResult)) {
    return result as DiamondLastPitchResult;
  }
  throw new DiamondScorebookError('invalid-response', 'The scorebook returned an invalid last delivered pitch result.');
}

function cloneJsonValue(value: unknown, depth = 0): DiamondJsonValue {
  if (depth > 12) {
    throw new DiamondScorebookError('invalid-input', 'Command payload is nested too deeply.');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DiamondScorebookError('invalid-input', 'Command payload contains an invalid number.');
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => cloneJsonValue(entry, depth + 1));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new DiamondScorebookError('invalid-input', 'Command payload must contain JSON-safe values only.');
  }
  return Object.entries(value as Record<string, unknown>).reduce<DiamondJsonObject>((result, [key, entry]) => {
    if (!key || ['__proto__', 'constructor', 'prototype'].includes(key) || entry === undefined) {
      throw new DiamondScorebookError('invalid-input', 'Command payload contains an unsupported field.');
    }
    result[key] = cloneJsonValue(entry, depth + 1);
    return result;
  }, {});
}

function cloneJsonObject(value: unknown): DiamondJsonObject {
  const cloned = cloneJsonValue(value);
  if (!cloned || Array.isArray(cloned) || typeof cloned !== 'object') {
    throw new DiamondScorebookError('invalid-input', 'Command payload must be an object.');
  }
  const serialized = JSON.stringify(cloned);
  if (serialized.length > 65_536) {
    throw new DiamondScorebookError('invalid-input', 'Command payload is too large.');
  }
  return cloned;
}

function normalizeCallableCode(error: unknown) {
  const source = asRecord(error);
  return compactText(source.code)
    .toLowerCase()
    .replace(/^functions\//, '');
}

function toDiamondError(error: unknown, fallbackMessage: string): DiamondScorebookError {
  if (error instanceof DiamondScorebookError) return error;
  const source = asRecord(error);
  const details = asRecord(source.details);
  const code = normalizeCallableCode(error);
  const reason = compactText(details.reason).toLowerCase().replace(/_/g, '-');
  const message = compactText(source.message) || fallbackMessage;
  const authoritativeRevision = normalizeOptionalRevision(details.authoritativeRevision ?? details.revision);

  if (code === 'permission-denied' || code === 'unauthenticated') {
    return new DiamondScorebookError('permission-denied', 'You no longer have permission to score this game.', { cause: error });
  }
  if (code === 'not-found') {
    return new DiamondScorebookError('not-found', 'This diamond scorebook is not available.', { cause: error });
  }
  if (reason === 'stale-revision' || code === 'aborted') {
    return new DiamondScorebookError('stale-revision', 'The game changed on another device. Refresh before recording another play.', {
      authoritativeRevision,
      cause: error
    });
  }
  if (code === 'already-exists' || reason === 'command-conflict') {
    return new DiamondScorebookError('conflict', 'This command ID was already used for a different play. Refresh before continuing.', {
      cause: error
    });
  }
  if (code === 'resource-exhausted' && (reason === 'scorer-candidate-rsvp-overflow' || reason === 'scorer-candidate-overflow')) {
    return new DiamondScorebookError('unavailable', message, {
      retryable: false,
      cause: error
    });
  }
  if (code === 'resource-exhausted') {
    return new DiamondScorebookError('rate-limited', 'Too many scorebook requests. Pause briefly, then retry.', {
      retryable: details.retryable !== false,
      cause: error
    });
  }
  if (code === 'invalid-argument' || code === 'failed-precondition') {
    return new DiamondScorebookError('invalid-input', message, { authoritativeRevision, cause: error });
  }
  if (code === 'network-request-failed' || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return new DiamondScorebookError('offline', 'The scorebook is offline. This play can be retried with the same command ID.', {
      retryable: true,
      cause: error
    });
  }
  if (retryableCallableCodes.has(code) || /(network|offline|timeout|timed out|unavailable|failed to fetch)/i.test(message)) {
    return new DiamondScorebookError('unavailable', 'The scorebook could not confirm this request. Retrying it is safe.', {
      retryable: true,
      cause: error
    });
  }
  return new DiamondScorebookError('unavailable', fallbackMessage, { cause: error });
}

const defaultTransport: DiamondCallableTransport = {
  async call<T>(name: string, data: Record<string, unknown>) {
    if (isNativeRuntime()) {
      return callNativeFirebaseFunction<T>(name, data, {
        errorLabel: 'Diamond scorebook',
        ...(name === 'listDiamondScorerCandidates' ? { timeoutMs: scorerCandidateNativeTimeoutMs } : {})
      });
    }
    const response = await httpsCallable(functions, name)(data);
    return response?.data as T;
  }
};

function scorerCandidateRetryKey(request: {
  authenticatedUid: string;
  teamId: string;
  gameId: string;
  expectedInstanceId: string;
  expectedRevision: number;
  leaseId: string;
}) {
  return JSON.stringify([
    request.authenticatedUid,
    request.teamId,
    request.gameId,
    request.expectedInstanceId,
    request.expectedRevision,
    request.leaseId
  ]);
}

function selectScorerCandidateRetryPrincipal(authenticatedUid: string) {
  if (scorerCandidateRetryPrincipal === authenticatedUid) return;
  scorerCandidateRetryHandles.clear();
  scorerCandidateRetryPrincipal = authenticatedUid;
}

function pruneScorerCandidateRetryHandles(nowMs: number) {
  for (const [key, handle] of scorerCandidateRetryHandles) {
    if (handle.expiresAtMs <= nowMs) scorerCandidateRetryHandles.delete(key);
  }
}

function scorerCandidateRetryHandle(key: string, cryptoSource: SecureCrypto | null | undefined) {
  const nowMs = Date.now();
  pruneScorerCandidateRetryHandles(nowMs);
  const existing = scorerCandidateRetryHandles.get(key);
  if (existing) return existing;
  if (scorerCandidateRetryHandles.size >= maxScorerCandidateRetryHandles) {
    throw new DiamondScorebookError('rate-limited', 'Too many scorer candidate retries are pending. Pause briefly, then retry.', {
      retryable: true
    });
  }
  const handle = {
    requestId: createSecureDiamondId(cryptoSource),
    expiresAtMs: nowMs + scorerCandidateRetryHandleRetentionMs
  };
  scorerCandidateRetryHandles.set(key, handle);
  return handle;
}

function finishScorerCandidateRetryHandle(key: string, requestId: string, retryable: boolean) {
  const current = scorerCandidateRetryHandles.get(key);
  if (current?.requestId !== requestId) return;
  if (!retryable) {
    scorerCandidateRetryHandles.delete(key);
    return;
  }
  current.expiresAtMs = Date.now() + scorerCandidateRetryHandleRetentionMs;
}

async function callWithRetry<T>(
  transport: DiamondCallableTransport,
  name: string,
  payload: Record<string, unknown>,
  fallbackMessage: string,
  maxAttempts = 2
) {
  const immutablePayload = cloneJsonObject(payload);
  let lastError: DiamondScorebookError | null = null;
  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
    try {
      return await transport.call<T>(name, immutablePayload);
    } catch (error) {
      lastError = toDiamondError(error, fallbackMessage);
      if (!lastError.retryable || attempt >= maxAttempts) throw lastError;
    }
  }
  throw lastError || new DiamondScorebookError('unavailable', fallbackMessage);
}

export function createSecureDiamondId(cryptoSource: SecureCrypto | null | undefined = globalThis.crypto) {
  if (cryptoSource && typeof cryptoSource.randomUUID === 'function') {
    const value = cryptoSource.randomUUID();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value.toLowerCase();
  }
  if (cryptoSource && typeof cryptoSource.getRandomValues === 'function') {
    const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }
  throw new DiamondScorebookError(
    'secure-randomness-unavailable',
    'Secure command IDs are unavailable on this device. Scoring is disabled until this page is reopened in a supported browser.'
  );
}

export function createDiamondCommand(
  input: {
    teamId: string;
    gameId: string;
    appBuild: number;
    expectedInstanceId: string;
    leaseId?: string | null;
    expectedRevision: number;
    rulesProfileId: string;
    rulesProfileVersion: number;
    type: DiamondCommandType;
    payload?: Record<string, unknown>;
  },
  cryptoSource?: SecureCrypto | null
): DiamondCommandEnvelope {
  if (!diamondCommandTypes.has(input.type)) {
    throw new DiamondScorebookError('invalid-input', 'Choose a supported diamond scorebook action.');
  }
  return {
    schemaVersion: 2,
    commandId: createSecureDiamondId(cryptoSource === undefined ? globalThis.crypto : cryptoSource),
    teamId: requireResourceId(input.teamId, 'Team ID'),
    gameId: requireResourceId(input.gameId, 'Game ID'),
    appBuild: requireAppBuild(input.appBuild),
    expectedInstanceId: requireDiamondInstanceId(input.expectedInstanceId, 'invalid-input'),
    ...(input.leaseId ? { leaseId: requireScorerLeaseId(input.leaseId) } : {}),
    expectedRevision: requireRevision(input.expectedRevision),
    rulesProfileId: requireResourceId(input.rulesProfileId, 'Rules profile ID'),
    rulesProfileVersion: requirePositiveVersion(input.rulesProfileVersion),
    type: input.type,
    payload: cloneJsonObject(input.payload || {})
  };
}

function normalizePlayer(value: unknown): DiamondPlayerRef | null {
  if (typeof value === 'string') {
    const playerId = compactText(value);
    return playerId ? { playerId, name: playerId, number: null } : null;
  }
  const source = asRecord(value);
  const playerId = compactText(source.playerId || source.activePlayerId || source.runnerId || source.id);
  const name = compactText(source.name || source.playerName || source.displayName) || playerId;
  if (!playerId) return null;
  return {
    playerId,
    name,
    number: compactText(source.number || source.playerNumber || source.jerseyNumber) || null
  };
}

function normalizeLineup(value: unknown): DiamondLineupEntry[] {
  const sourceValue = asRecord(value);
  const rows = Array.isArray(value) ? value : Array.isArray(sourceValue.battingOrder) ? sourceValue.battingOrder : [];
  return rows
    .flatMap((entry, index) => {
      const source = asRecord(entry);
      const player = normalizePlayer(source);
      if (!player) return [];
      return [
        {
          ...player,
          slot: normalizeBoundedInteger(source.slot, 1, 99, index + 1),
          active: source.active !== false,
          battingRole: compactText(source.battingRole) || null,
          starterPlayerId: compactText(source.starterPlayerId) || player.playerId,
          starterReentriesUsed: normalizeBoundedInteger(source.starterReentriesUsed, 0, 99, 0),
          substitutions: Array.isArray(source.substitutions) ? source.substitutions.map(compactText).filter(Boolean).slice(0, 100) : []
        }
      ];
    })
    .sort((a, b) => a.slot - b.slot)
    .slice(0, 25);
}

const diamondDefensivePositions: readonly DiamondDefensivePosition[] = [
  'P',
  'C',
  '1B',
  '2B',
  '3B',
  'SS',
  'LF',
  'LCF',
  'CF',
  'RCF',
  'RF',
  'DP',
  'FLEX',
  'EH',
  'EP'
];

function normalizeDefense(value: unknown, playersById: ReadonlyMap<string, DiamondPlayerRef>): DiamondDefense {
  const source = asRecord(value);
  return diamondDefensivePositions.reduce<DiamondDefense>((result, position) => {
    const player = normalizePlayer(source[position]);
    if (!player) return result;
    result[position] = playersById.get(player.playerId) || player;
    return result;
  }, {});
}

function normalizeRunner(value: unknown, playersById: ReadonlyMap<string, DiamondPlayerRef>): DiamondRunnerRef | null {
  const source = asRecord(value);
  const player = normalizePlayer(value);
  if (!player) return null;
  const enriched = playersById.get(player.playerId) || player;
  return {
    ...enriched,
    responsiblePitcherId: compactText(source.chargedToPitcherId || source.responsiblePitcherId) || null,
    courtesyForPlayerId: compactText(source.courtesyForPlayerId || source.courtesyFor) || null,
    reachedOnEventId: compactText(source.reachedOnEventId) || null
  };
}

function normalizePlayerList(value: unknown, fallback: DiamondPlayerRef[] = []): DiamondPlayerRef[] {
  const seen = new Set<string>();
  return [...(Array.isArray(value) ? value : []), ...fallback]
    .flatMap((entry) => {
      const player = normalizePlayer(entry);
      if (!player || seen.has(player.playerId)) return [];
      seen.add(player.playerId);
      return [player];
    })
    .slice(0, 100);
}

function normalizePlayerIdList(value: unknown): string[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : [])
    .flatMap((entry) => {
      const playerId = compactText(entry);
      if (!playerId || seen.has(playerId)) return [];
      seen.add(playerId);
      return [playerId];
    })
    .slice(0, 100);
}

function normalizeCoverageStatus(value: unknown): DiamondCoverageStatus {
  return value === 'complete' || value === 'not_collected' ? value : 'partial';
}

function normalizeCompleteness(value: unknown, revision: number): DiamondCompletenessEvidence {
  const source = asRecord(value);
  const familiesSource = asRecord(source.families || source.statFamilies || source.byFamily || source);
  const families = Object.entries(familiesSource).reduce<Record<string, DiamondCoverageStatus>>((result, [key, entry]) => {
    const normalizedKey = compactText(key);
    if (normalizedKey) result[normalizedKey] = normalizeCoverageStatus(asRecord(entry).status || entry);
    return result;
  }, {});
  const derivedStatus = Object.values(families).some((status) => status === 'partial') ? 'partial' : 'complete';
  return {
    status: source.status ? normalizeCoverageStatus(source.status) : Object.keys(families).length ? derivedStatus : 'partial',
    authoritativeRevision: normalizeOptionalRevision(source.authoritativeRevision) ?? revision,
    families,
    omissions: Array.isArray(source.omissions) ? source.omissions.map(compactText).filter(Boolean).slice(0, 100) : []
  };
}

function normalizeDecisionEventId(value: unknown, label: string) {
  const eventId = compactText(value);
  if (!eventId || eventId.length > 128 || eventId.includes('/')) {
    throw new DiamondScorebookError('invalid-response', `The scorebook returned an invalid ${label} event ID.`);
  }
  return eventId;
}

function normalizeHalfInningEnd(value: unknown): DiamondHalfInningEnd | null {
  if (value === null || value === undefined) return null;
  const source = asRecord(value);
  if (source.reason !== 'run-limit') {
    throw new DiamondScorebookError('invalid-response', 'The scorebook returned an invalid half-inning ending decision.');
  }
  return {
    reason: 'run-limit',
    decisionEventId: normalizeDecisionEventId(source.decisionEventId, 'half-inning decision')
  };
}

function normalizeGameEndDecision(value: unknown): DiamondGameEndDecision | null {
  if (value === null || value === undefined) return null;
  const source = asRecord(value);
  const reason = source.reason;
  if (reason !== 'time-limit' && reason !== 'weather' && reason !== 'forfeit') {
    throw new DiamondScorebookError('invalid-response', 'The scorebook returned an invalid game-ending decision.');
  }
  if (source.awardedSide !== null && source.awardedSide !== 'home' && source.awardedSide !== 'away') {
    throw new DiamondScorebookError('invalid-response', 'The scorebook returned an invalid game-ending award.');
  }
  const awardedSide = source.awardedSide;
  if ((reason === 'forfeit') !== (awardedSide !== null)) {
    throw new DiamondScorebookError('invalid-response', 'The scorebook returned an invalid game-ending award.');
  }
  return {
    reason,
    decisionEventId: normalizeDecisionEventId(source.decisionEventId, 'game-ending decision'),
    awardedSide
  };
}

function normalizeFinalizationReason(value: unknown): DiamondFinalizationReason | null {
  if (value === null || value === undefined) return null;
  const source = asRecord(value);
  const kind = source.kind;
  if (typeof kind !== 'string' || !['regulation', 'walkoff', 'run-ahead', 'time-limit', 'weather', 'forfeit'].includes(kind)) {
    throw new DiamondScorebookError('invalid-response', 'The scorebook returned an invalid finalization reason.');
  }
  const requiresDecision = kind === 'time-limit' || kind === 'weather' || kind === 'forfeit';
  const decisionEventId = source.decisionEventId == null ? null : normalizeDecisionEventId(source.decisionEventId, 'finalization decision');
  if (requiresDecision !== (decisionEventId !== null)) {
    throw new DiamondScorebookError('invalid-response', 'The scorebook returned invalid finalization evidence.');
  }
  return { kind: kind as DiamondFinalizationReason['kind'], decisionEventId };
}

function normalizeRecentPlays(value: unknown): DiamondRecentPlay[] {
  return (Array.isArray(value) ? value : [])
    .flatMap((entry) => {
      const source = asRecord(entry);
      const eventId = compactText(source.eventId || source.id);
      const label = compactText(source.label || source.description || source.summary);
      const revision = normalizeOptionalRevision(source.revision);
      if (!eventId || !label || revision === null) return [];
      return [
        {
          eventId,
          revision,
          label,
          inningLabel: compactText(source.inningLabel || source.period) || 'Game',
          createdAt: compactText(source.createdAt) || null,
          voided: source.voided === true
        }
      ];
    })
    .slice(0, 20);
}

function normalizeLease(value: unknown, currentScorerUid: unknown): DiamondScorerLease {
  const source = asRecord(value);
  const holderUid = compactText(source.holderUid || source.scorerUid || currentScorerUid) || null;
  const claimedCanScore = source.canScore === true || source.ownedByCaller === true;
  const rawStatus = compactText(source.status);
  const status: DiamondScorerLease['status'] =
    rawStatus === 'owned' ||
    rawStatus === 'held-by-other' ||
    rawStatus === 'available' ||
    rawStatus === 'expired' ||
    rawStatus === 'unavailable'
      ? rawStatus
      : claimedCanScore
        ? 'owned'
        : holderUid
          ? 'held-by-other'
          : 'available';
  const rawLeaseId = compactText(source.leaseId);
  if (rawLeaseId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawLeaseId)) {
    throw new DiamondScorebookError('invalid-response', 'The scorebook returned an invalid scorer lease ID.');
  }
  const rawEpoch = source.epoch;
  const epoch = Number.isSafeInteger(rawEpoch) && Number(rawEpoch) > 0 ? Number(rawEpoch) : null;
  const rawExpiresAt = compactText(source.expiresAt);
  if (rawExpiresAt && (!Number.isFinite(Date.parse(rawExpiresAt)) || rawExpiresAt.length > 64)) {
    throw new DiamondScorebookError('invalid-response', 'The scorebook returned an invalid scorer lease expiry.');
  }
  const leaseId = rawLeaseId ? rawLeaseId.toLowerCase() : null;
  return {
    status,
    canScore: claimedCanScore && status === 'owned' && leaseId !== null,
    canAcquire: source.canAcquire === true,
    canRecover: source.canRecover === true,
    holderUid,
    holderName: compactText(source.holderName || source.scorerName) || null,
    leaseId,
    epoch,
    expiresAt: rawExpiresAt || null,
    eligibleScorers: (Array.isArray(source.eligibleScorers) ? source.eligibleScorers : [])
      .map(normalizePlayer)
      .filter(Boolean) as DiamondPlayerRef[]
  };
}

export function normalizeDiamondSnapshot(value: unknown): DiamondScorebookSnapshot {
  const root = asRecord(value);
  const state = asRecord(root.state || root.gameState || root.snapshot || root);
  const presentation = asRecord(root.presentation || state.presentation);
  const revision = normalizeOptionalRevision(root.revision ?? state.revision);
  if (revision === null) {
    throw new DiamondScorebookError('invalid-response', 'The scorebook response did not include an authoritative revision.');
  }
  const teamId = requireResourceId(root.teamId || state.teamId, 'Team ID');
  const gameId = requireResourceId(root.gameId || state.gameId, 'Game ID');
  const instanceId = requireDiamondInstanceId(root.instanceId || state.instanceId, 'invalid-response');
  const inningSource = asRecord(state.inning);
  const countSource = asRecord(state.count || inningSource.count);
  const scoreSource = asRecord(state.score);
  const basesSource = asRecord(state.bases);
  const lineupSource = asRecord(state.lineups || presentation.lineups);
  const hasExactHalf = inningSource.half === 'top' || inningSource.half === 'bottom';
  const half: DiamondHalf = inningSource.half === 'bottom' ? 'bottom' : 'top';
  const hasExactInningNumber =
    Number.isSafeInteger(inningSource.number) && Number(inningSource.number) >= 1 && Number(inningSource.number) <= 99;
  const inningNumber = normalizeBoundedInteger(inningSource.number, 1, 99, 1);
  const inningKey = `${half === 'top' ? 'T' : 'B'}${String(inningNumber)}`;
  const currentHalfRuns = hasExactHalf && hasExactInningNumber ? normalizeCurrentHalfRuns(state.inningRuns, inningKey) : null;
  const lastPitchResult = normalizeLastPitchResult(inningSource);
  const lifecycleSource = compactText(state.lifecycle);
  const lifecycle: DiamondLifecycle = ['configured', 'ready', 'active', 'suspended', 'final', 'correction', 'cancelled'].includes(
    lifecycleSource
  )
    ? (lifecycleSource as DiamondLifecycle)
    : 'configured';
  const captureMode: DiamondCaptureMode = state.captureMode === 'full' ? 'full' : 'quick';
  const battingSide = half === 'top' ? 'away' : 'home';
  const rawHomeLineup = normalizeLineup(lineupSource.home);
  const rawAwayLineup = normalizeLineup(lineupSource.away);
  const courtesyRunnerIds = {
    home: normalizePlayerIdList(asRecord(lineupSource.home).courtesyRunnerIds),
    away: normalizePlayerIdList(asRecord(lineupSource.away).courtesyRunnerIds)
  } satisfies Record<DiamondSide, string[]>;
  const candidatesSource = presentation.availablePlayers || presentation.rosterCandidates;
  const candidateSides = asRecord(candidatesSource);
  const flatCandidates = Array.isArray(candidatesSource) ? candidatesSource : [];
  const homeCandidates = normalizePlayerList(
    candidateSides.home || presentation.homePlayers || flatCandidates.filter((candidate) => asRecord(candidate).side === 'home'),
    rawHomeLineup
  );
  const awayCandidates = normalizePlayerList(
    candidateSides.away || presentation.awayPlayers || flatCandidates.filter((candidate) => asRecord(candidate).side === 'away'),
    rawAwayLineup
  );
  const playersBySide: Record<DiamondSide, ReadonlyMap<string, DiamondPlayerRef>> = {
    home: new Map([...rawHomeLineup, ...homeCandidates].map((player) => [player.playerId, player])),
    away: new Map([...rawAwayLineup, ...awayCandidates].map((player) => [player.playerId, player]))
  };
  const enrichLineup = (entries: DiamondLineupEntry[], side: DiamondSide) =>
    entries.map((entry) => ({ ...entry, ...(playersBySide[side].get(entry.playerId) || {}) }));
  const homeLineup = enrichLineup(rawHomeLineup, 'home');
  const awayLineup = enrichLineup(rawAwayLineup, 'away');
  const nextBatterSlots = {
    home: normalizeBoundedInteger(asRecord(state.nextBatterSlot).home, 0, 98, 0),
    away: normalizeBoundedInteger(asRecord(state.nextBatterSlot).away, 0, 98, 0)
  };
  const battingLineup = enrichLineup(
    normalizeLineup(presentation.battingLineup || lineupSource[battingSide] || state.battingLineup),
    battingSide
  );
  const nextBatterSlot = nextBatterSlots[battingSide];
  const derivedBatter = battingLineup.length ? battingLineup[nextBatterSlot % battingLineup.length] || null : null;
  const defensiveSide = battingSide === 'home' ? 'away' : 'home';
  const defensiveLineupSource = asRecord(lineupSource[defensiveSide]);
  const defense = {
    home: normalizeDefense(asRecord(lineupSource.home).defense, playersBySide.home),
    away: normalizeDefense(asRecord(lineupSource.away).defense, playersBySide.away)
  } satisfies Record<DiamondSide, DiamondDefense>;
  const derivedPitcherId = defense[defensiveSide].P?.playerId || compactText(asRecord(defensiveLineupSource.defense).P);
  const defensePlayers = Object.values(defense[defensiveSide]).filter(Boolean) as DiamondPlayerRef[];
  const defensiveLineup = defensePlayers.filter(
    (player, index, all) => all.findIndex((candidate) => candidate.playerId === player.playerId) === index
  );
  const presentedBases = asRecord(presentation.bases);
  const normalizeBase = (name: 'first' | 'second' | 'third', number: '1' | '2' | '3') => {
    const canonical = asRecord(basesSource[name] || basesSource[number]);
    const presented = asRecord(presentedBases[name] || presentedBases[number]);
    return normalizeRunner({ ...canonical, ...presented }, playersBySide[battingSide]);
  };
  const lease = normalizeLease(root.lease || state.lease, state.currentScorerUid);
  const rulesProfileId = requireResourceId(state.rulesProfileId || root.rulesProfileId, 'Rules profile ID');
  const rulesProfileVersion = requirePositiveVersion(state.rulesProfileVersion || root.rulesProfileVersion);
  const managedSideValue = compactText(presentation.managedSide || root.managedSide);
  const managedSide: DiamondSide | null = managedSideValue === 'home' || managedSideValue === 'away' ? managedSideValue : null;
  const capabilitiesSource = asRecord(presentation.rulesCapabilities || root.rulesCapabilities);
  const courtesySource = asRecord(capabilitiesSource.courtesyRunner);
  const localProfileId = rulesProfileId.endsWith(`@${rulesProfileVersion}`)
    ? rulesProfileId.slice(0, -String(rulesProfileVersion).length - 1)
    : rulesProfileId;
  const localProfile = getDiamondRulesProfile(localProfileId, rulesProfileVersion);
  const dpFlexSource = capabilitiesSource.dpFlex;
  const ruleCapabilities: DiamondRuleCapabilities = {
    dpFlex:
      dpFlexSource === true ||
      asRecord(dpFlexSource).enabled === true ||
      (dpFlexSource === undefined && localProfile?.dpFlex.enabled === true),
    courtesyRunner: {
      pitcher: courtesySource.pitcher === true || (courtesySource.pitcher === undefined && localProfile?.courtesyRunner.pitcher === true),
      catcher: courtesySource.catcher === true || (courtesySource.catcher === undefined && localProfile?.courtesyRunner.catcher === true)
    }
  };
  const completeness = normalizeCompleteness(root.completeness || state.coverage, revision);
  const teamName = compactText(presentation.teamName || root.teamName) || 'Your team';
  const opponentName = compactText(presentation.opponentName || root.opponentName) || 'Opponent';

  return {
    schemaVersion: 2,
    teamId,
    gameId,
    instanceId,
    revision,
    checkpointHash: compactText(state.checkpointHash || root.checkpointHash),
    authoritative: root.authoritative !== false && completeness.authoritativeRevision === revision,
    lifecycle,
    captureMode,
    rulesProfileId,
    rulesProfileVersion,
    teamName,
    opponentName,
    homeName: compactText(presentation.homeName || root.homeName) || teamName,
    awayName: compactText(presentation.awayName || root.awayName) || opponentName,
    score: {
      home: normalizeNonnegative(scoreSource.home ?? scoreSource.homeScore ?? state.homeScore),
      away: normalizeNonnegative(scoreSource.away ?? scoreSource.awayScore ?? state.awayScore)
    },
    currentHalfRuns,
    lastPitchResult,
    inning: {
      number: inningNumber,
      half,
      outs: normalizeBoundedInteger(inningSource.outs, 0, 3, 0),
      balls: normalizeBoundedInteger(inningSource.balls ?? countSource.balls, 0, 4, 0),
      strikes: normalizeBoundedInteger(inningSource.strikes ?? countSource.strikes, 0, 3, 0),
      pitchesInPlateAppearance: normalizeBoundedInteger(inningSource.pitchesInPlateAppearance, 0, 999, 0)
    },
    bases: {
      first: normalizeBase('first', '1'),
      second: normalizeBase('second', '2'),
      third: normalizeBase('third', '3')
    },
    currentBatter:
      derivedBatter ||
      (() => {
        const player = normalizePlayer(state.currentBatter || presentation.currentBatter);
        return player ? playersBySide[battingSide].get(player.playerId) || player : null;
      })(),
    currentPitcher: derivedPitcherId ? playersBySide[defensiveSide].get(derivedPitcherId) || normalizePlayer(derivedPitcherId) : null,
    lineups: { home: homeLineup, away: awayLineup },
    courtesyRunnerIds,
    defense,
    nextBatterSlot: nextBatterSlots,
    battingLineup,
    defensiveLineup,
    availablePlayers: {
      home: homeCandidates,
      away: awayCandidates
    },
    managedSide,
    ruleCapabilities,
    halfInningEnd: normalizeHalfInningEnd(state.halfInningEnd),
    gameEndDecision: normalizeGameEndDecision(state.gameEndDecision),
    finalizationReason: normalizeFinalizationReason(state.finalizationReason),
    recentPlays: normalizeRecentPlays(root.recentPlays || presentation.recentPlays || state.recentPlays),
    lease,
    completeness,
    readOnlyReason: compactText(root.readOnlyReason || state.readOnlyReason) || null
  };
}

function normalizeCommandOutcome(value: unknown, command: DiamondCommandEnvelope): DiamondCommandOutcome {
  const source = asRecord(value);
  const rawOutcome = compactText(source.outcome);
  if (rawOutcome === 'rejected') {
    const rejection = asRecord(source.rejection);
    const reason = compactText(rejection.code || rejection.reason)
      .toLowerCase()
      .replace(/_/g, '-');
    const stale = reason === 'stale-revision' || reason === 'revision-mismatch';
    const conflict = reason === 'command-conflict' || reason === 'duplicate-command-conflict';
    throw new DiamondScorebookError(
      stale ? 'stale-revision' : conflict ? 'conflict' : 'rejected',
      compactText(rejection.message) || 'The scorebook rejected this action.',
      {
        // A structured rejection is definitive. Its server retryable bit means
        // the caller may refresh/recover, not that this exact mutation had an
        // ambiguous outcome and belongs in the durable offline queue.
        retryable: false,
        authoritativeRevision: normalizeOptionalRevision(rejection.authoritativeRevision ?? source.revision)
      }
    );
  }
  if (rawOutcome !== 'accepted' && rawOutcome !== 'duplicate') {
    throw new DiamondScorebookError('invalid-response', 'The scorebook did not confirm whether the command was accepted.');
  }
  const revision = normalizeOptionalRevision(source.revision);
  if (revision === null || revision <= command.expectedRevision) {
    throw new DiamondScorebookError('invalid-response', 'The scorebook returned an invalid command revision.');
  }
  const snapshotValue = source.state || source.snapshot;
  const snapshot = snapshotValue ? normalizeDiamondSnapshot({ ...asRecord(snapshotValue), revision }) : null;
  if (snapshot && snapshot.instanceId !== command.expectedInstanceId) {
    throw new DiamondScorebookError('invalid-response', 'The scorebook returned a different Diamond game instance.');
  }
  return {
    outcome: rawOutcome,
    revision,
    eventId: compactText(source.eventId) || null,
    snapshot,
    completeness: snapshot?.completeness || normalizeCompleteness(source.completeness, revision)
  };
}

export async function getDiamondState(teamId: string, gameId: string, options: { transport?: DiamondCallableTransport } = {}) {
  const payload = {
    teamId: requireResourceId(teamId, 'Team ID'),
    gameId: requireResourceId(gameId, 'Game ID'),
    visibility: 'private'
  };
  try {
    const result = await callWithRetry<unknown>(
      options.transport || defaultTransport,
      'getDiamondState',
      payload,
      'Unable to load the diamond scorebook.'
    );
    return normalizeDiamondSnapshot(result);
  } catch (error) {
    throw toDiamondError(error, 'Unable to load the diamond scorebook.');
  }
}

export async function listDiamondScorerCandidates(
  input: {
    authenticatedUid: string;
    teamId: string;
    gameId: string;
    expectedInstanceId: string;
    expectedRevision: number;
    leaseId: string;
  },
  options: { transport?: DiamondCallableTransport; maxAttempts?: number; crypto?: SecureCrypto | null } = {}
): Promise<DiamondScorerCandidateList> {
  const request = {
    authenticatedUid: requireResourceId(input.authenticatedUid, 'Authenticated user ID'),
    teamId: requireResourceId(input.teamId, 'Team ID'),
    gameId: requireResourceId(input.gameId, 'Game ID'),
    expectedInstanceId: requireDiamondInstanceId(input.expectedInstanceId, 'invalid-input'),
    expectedRevision: requireRevision(input.expectedRevision),
    leaseId: requireScorerLeaseId(input.leaseId)
  };
  selectScorerCandidateRetryPrincipal(request.authenticatedUid);
  const retryKey = scorerCandidateRetryKey(request);
  const retryHandle = scorerCandidateRetryHandle(retryKey, options.crypto);
  const payload = {
    requestId: retryHandle.requestId,
    teamId: request.teamId,
    gameId: request.gameId,
    expectedInstanceId: request.expectedInstanceId,
    expectedRevision: request.expectedRevision,
    leaseId: request.leaseId
  };
  try {
    const raw = await callWithRetry<unknown>(
      options.transport || defaultTransport,
      'listDiamondScorerCandidates',
      payload,
      'Unable to load scorer handoff candidates.',
      options.maxAttempts ?? 2
    );
    const source = requireResponseRecord(raw, 'scorer candidate list');
    requireExactResponseKeys(
      source,
      ['schemaVersion', 'complete', 'teamId', 'gameId', 'instanceId', 'revision', 'leaseId', 'candidates'],
      'Scorer candidate list'
    );
    if (source.schemaVersion !== 1 || source.complete !== true) {
      throw new DiamondScorebookError('invalid-response', 'The scorer candidate list did not prove a complete supported result.');
    }
    const teamId = requireResponseResourceId(source.teamId, 'scorer candidate team ID');
    const gameId = requireResponseResourceId(source.gameId, 'scorer candidate game ID');
    const instanceId = requireDiamondInstanceId(source.instanceId, 'invalid-response');
    const revision = normalizeOptionalRevision(source.revision);
    let leaseId: string;
    try {
      leaseId = requireScorerLeaseId(source.leaseId);
    } catch (error) {
      throw new DiamondScorebookError('invalid-response', 'The scorer candidate list returned an invalid lease ID.', { cause: error });
    }
    if (
      teamId !== payload.teamId ||
      gameId !== payload.gameId ||
      instanceId !== payload.expectedInstanceId ||
      revision !== payload.expectedRevision ||
      leaseId !== payload.leaseId
    ) {
      throw new DiamondScorebookError('invalid-response', 'The scorer candidate list belongs to another scorebook revision or lease.');
    }
    if (!Array.isArray(source.candidates) || source.candidates.length > maxScorerCandidates) {
      throw new DiamondScorebookError('invalid-response', 'The scorer candidate list exceeded its safe bound.');
    }
    const seen = new Set<string>();
    const candidates = source.candidates.map((value): DiamondPlayerRef => {
      const candidate = requireResponseRecord(value, 'scorer candidate');
      requireExactResponseKeys(candidate, ['playerId', 'name'], 'Scorer candidate');
      const playerId = requireResponseResourceId(candidate.playerId, 'scorer candidate ID');
      if (seen.has(playerId)) {
        throw new DiamondScorebookError('invalid-response', 'The scorer candidate list contained a duplicate account.');
      }
      seen.add(playerId);
      return { playerId, name: requireScorerCandidateName(candidate.name) };
    });
    const result: DiamondScorerCandidateList = {
      schemaVersion: 1,
      complete: true,
      teamId,
      gameId,
      instanceId,
      revision: revision!,
      leaseId,
      candidates
    };
    finishScorerCandidateRetryHandle(retryKey, retryHandle.requestId, false);
    return result;
  } catch (error) {
    const normalized = toDiamondError(error, 'Unable to load scorer handoff candidates.');
    finishScorerCandidateRetryHandle(retryKey, retryHandle.requestId, normalized.retryable);
    throw normalized;
  }
}

type DiamondPrivateEventPage = {
  sourceRevision: number;
  items: DiamondPrivateEvent[];
  nextCursor: string | null;
  collectionComplete: boolean;
  byteLength: number;
};

const privateEventPageFields = new Set([
  'sourceRevision',
  'items',
  'nextCursor',
  'complete',
  'accessComplete',
  'collectionComplete',
  'responseByteCount',
  'responseByteLimit'
]);
const privateEventSummaryFields = new Set([
  'eventId',
  'sequence',
  'revision',
  'type',
  'payload',
  'serverTimestampMs',
  'createdAt',
  'voidsEventId',
  'supersedesEventId'
]);

function normalizePrivateEventLink(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return null;
  return normalizeDecisionEventId(value, label);
}

function normalizePrivateEventTimestamp(event: Record<string, unknown>) {
  if (event.serverTimestampMs !== null && event.serverTimestampMs !== undefined) {
    const timestamp = event.serverTimestampMs;
    if (!Number.isSafeInteger(timestamp) || Number(timestamp) < 0 || Number(timestamp) > 8_640_000_000_000_000) {
      throw new DiamondScorebookError('invalid-response', 'The private scorebook history contained an invalid timestamp.');
    }
    return new Date(Number(timestamp)).toISOString();
  }
  if (event.createdAt === null || event.createdAt === undefined || event.createdAt === '') return null;
  const createdAt = compactText(event.createdAt);
  if (createdAt.length > 64 || !Number.isFinite(Date.parse(createdAt))) {
    throw new DiamondScorebookError('invalid-response', 'The private scorebook history contained an invalid timestamp.');
  }
  return new Date(createdAt).toISOString();
}

function normalizePrivateEventPage(value: unknown): DiamondPrivateEventPage {
  const byteLength = serializedUtf8Bytes(value, 'private scorebook history');
  if (byteLength > maxPrivateEventPageBytes) {
    throw new DiamondScorebookError('unavailable', 'A private scorebook history page exceeded the safe scorer-view limit.', {
      retryable: false
    });
  }
  const source = requireResponseRecord(value, 'private scorebook history');
  requireExactResponseFields(source, privateEventPageFields, 'private scorebook history');
  if (
    !Number.isSafeInteger(source.responseByteCount) ||
    source.responseByteCount !== byteLength ||
    source.responseByteLimit !== maxPrivateEventPageBytes ||
    Number(source.responseByteCount) > Number(source.responseByteLimit)
  ) {
    throw new DiamondScorebookError('invalid-response', 'The private scorebook history returned invalid byte-bound evidence.');
  }
  const sourceRevision = normalizeOptionalRevision(source.sourceRevision);
  if (sourceRevision === null || source.complete !== true || source.accessComplete !== true) {
    throw new DiamondScorebookError(
      'unavailable',
      'The private scorebook history could not be read completely. Retry before using it for notes or corrections.',
      { retryable: true, authoritativeRevision: sourceRevision }
    );
  }
  const items = (Array.isArray(source.items) ? source.items : []).map((entry): DiamondPrivateEvent => {
    const event = requireResponseRecord(entry, 'private scorebook event summary');
    requireExactResponseFields(event, privateEventSummaryFields, 'private scorebook event summary');
    const type = compactText(event.type) as DiamondCommandType;
    if (!diamondCommandTypes.has(type)) {
      throw new DiamondScorebookError('invalid-response', 'The private scorebook history contained an unsupported event type.');
    }
    const sequence = normalizeOptionalRevision(event.sequence);
    const revision = normalizeOptionalRevision(event.revision);
    if (sequence === null || sequence < 1 || revision === null || revision !== sequence) {
      throw new DiamondScorebookError('invalid-response', 'The private scorebook history contained an invalid event sequence.');
    }
    let payload: DiamondJsonObject;
    try {
      payload = cloneJsonObject(event.payload || {});
    } catch {
      throw new DiamondScorebookError('invalid-response', 'The private scorebook history contained an invalid event payload.');
    }
    return {
      eventId: normalizeDecisionEventId(event.eventId, 'private scorebook'),
      sequence,
      revision,
      type,
      payload,
      createdAt: normalizePrivateEventTimestamp(event),
      voidsEventId: normalizePrivateEventLink(event.voidsEventId, 'void target'),
      supersedesEventId: normalizePrivateEventLink(event.supersedesEventId, 'superseded target')
    };
  });
  for (let index = 1; index < items.length; index += 1) {
    if (items[index]!.sequence !== items[index - 1]!.sequence + 1) {
      throw new DiamondScorebookError('invalid-response', 'The private scorebook history page is not contiguous.');
    }
  }
  const nextCursor = source.nextCursor == null ? null : compactText(source.nextCursor);
  if (nextCursor !== null && (!/^\d+$/.test(nextCursor) || Number(nextCursor) !== items[items.length - 1]?.sequence)) {
    throw new DiamondScorebookError('invalid-response', 'The private scorebook history returned an invalid continuation cursor.');
  }
  const collectionComplete = source.collectionComplete === true;
  if (collectionComplete !== (nextCursor === null)) {
    throw new DiamondScorebookError('invalid-response', 'The private scorebook history returned inconsistent completeness evidence.');
  }
  return { sourceRevision, items, nextCursor, collectionComplete, byteLength };
}

async function listDiamondPrivateEventPage(
  input: { teamId: string; gameId: string; cursor?: string | null; limit?: number },
  options: { transport?: DiamondCallableTransport } = {}
): Promise<DiamondPrivateEventPage> {
  const limit = normalizeBoundedInteger(input.limit, 1, 200, 200);
  const cursor = input.cursor ? compactText(input.cursor) : null;
  if (cursor && !/^\d+$/.test(cursor)) throw new DiamondScorebookError('invalid-input', 'The private event cursor is invalid.');
  try {
    const raw = await callWithRetry<unknown>(
      options.transport || defaultTransport,
      'listDiamondEvents',
      {
        teamId: requireResourceId(input.teamId, 'Team ID'),
        gameId: requireResourceId(input.gameId, 'Game ID'),
        visibility: 'private',
        limit,
        ...(cursor ? { cursor } : {})
      },
      'Unable to load private scorebook history.'
    );
    return normalizePrivateEventPage(raw);
  } catch (error) {
    throw toDiamondError(error, 'Unable to load private scorebook history.');
  }
}

function requirePrivateHistoryWindowSize(value: unknown) {
  if (value === undefined || value === null) return defaultPrivateHistoryWindowEvents;
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1 || size > maxPrivateHistoryWindowEvents) {
    throw new DiamondScorebookError(
      'invalid-input',
      `Private history windows must contain between 1 and ${maxPrivateHistoryWindowEvents} events.`
    );
  }
  return size;
}

function assertPrivateHistoryWindowEvidence(window: DiamondPrivateHistoryWindow, label: string) {
  const expectedEmpty = window.sourceRevision === 0 && window.items.length === 0;
  if (expectedEmpty) {
    if (
      window.oldestSequence !== null ||
      window.newestSequence !== null ||
      !window.headComplete ||
      !window.historyComplete ||
      window.hasOlder
    ) {
      throw new DiamondScorebookError('invalid-response', `${label} contained inconsistent empty-history evidence.`);
    }
    return;
  }
  const oldest = window.items[0]?.sequence ?? null;
  const newest = window.items[window.items.length - 1]?.sequence ?? null;
  if (
    oldest === null ||
    newest === null ||
    window.oldestSequence !== oldest ||
    window.newestSequence !== newest ||
    window.contiguous !== true ||
    window.rangeComplete !== true ||
    window.headComplete !== (newest === window.sourceRevision) ||
    window.historyComplete !== (oldest === 1 && newest === window.sourceRevision) ||
    window.hasOlder !== oldest > 1
  ) {
    throw new DiamondScorebookError('invalid-response', `${label} contained inconsistent completeness evidence.`);
  }
  for (let index = 1; index < window.items.length; index += 1) {
    if (window.items[index]!.sequence !== window.items[index - 1]!.sequence + 1) {
      throw new DiamondScorebookError('invalid-response', `${label} was not contiguous.`);
    }
  }
}

/**
 * Read one exact private-summary range without walking the ledger from event 1.
 * The existing ascending cursor remains sufficient: choose the first sequence
 * locally, then page forward only until the requested exclusive boundary.
 */
export async function getDiamondPrivateHistoryWindow(
  input: {
    teamId: string;
    gameId: string;
    expectedRevision: number;
    beforeSequence?: number | null;
    windowSize?: number;
  },
  options: { transport?: DiamondCallableTransport } = {}
): Promise<DiamondPrivateHistoryWindow> {
  const expectedRevision = requireRevision(input.expectedRevision);
  const windowSize = requirePrivateHistoryWindowSize(input.windowSize);
  let requestedEnd = expectedRevision;
  if (input.beforeSequence !== undefined && input.beforeSequence !== null) {
    const beforeSequence = Number(input.beforeSequence);
    if (!Number.isSafeInteger(beforeSequence) || beforeSequence < 2 || beforeSequence > expectedRevision) {
      throw new DiamondScorebookError('invalid-input', 'The older private-history boundary is invalid.');
    }
    requestedEnd = beforeSequence - 1;
  }

  if (expectedRevision === 0) {
    const page = await listDiamondPrivateEventPage({ teamId: input.teamId, gameId: input.gameId, limit: 1 }, options);
    if (page.sourceRevision !== 0 || page.items.length !== 0 || page.nextCursor !== null || !page.collectionComplete) {
      throw new DiamondScorebookError('invalid-response', 'The empty private scorebook history returned inconsistent evidence.');
    }
    return {
      sourceRevision: 0,
      oldestSequence: null,
      newestSequence: null,
      contiguous: true,
      rangeComplete: true,
      headComplete: true,
      historyComplete: true,
      hasOlder: false,
      items: []
    };
  }

  const requestedStart = Math.max(1, requestedEnd - windowSize + 1);
  const items: DiamondPrivateEvent[] = [];
  let totalBytes = 0;
  let afterSequence = requestedStart - 1;
  while (afterSequence < requestedEnd) {
    const remaining = requestedEnd - afterSequence;
    const page = await listDiamondPrivateEventPage(
      {
        teamId: input.teamId,
        gameId: input.gameId,
        cursor: afterSequence > 0 ? String(afterSequence) : null,
        limit: Math.min(maxPrivateHistoryWindowEvents, remaining)
      },
      options
    );
    if (page.sourceRevision !== expectedRevision) {
      throw new DiamondScorebookError(
        'stale-revision',
        'The scorebook changed while private history was loading. Refresh before using notes or corrections.',
        { authoritativeRevision: page.sourceRevision }
      );
    }
    totalBytes += page.byteLength;
    if (totalBytes > maxPrivateHistoryWindowBytes) {
      throw new DiamondScorebookError('unavailable', 'This private-history window exceeds the safe scorer-view byte limit.', {
        retryable: false,
        authoritativeRevision: expectedRevision
      });
    }
    if (!page.items.length || page.items[0]!.sequence !== afterSequence + 1) {
      throw new DiamondScorebookError('invalid-response', 'The private scorebook history window is not contiguous.');
    }
    const lastSequence = page.items[page.items.length - 1]!.sequence;
    if (lastSequence > requestedEnd) {
      throw new DiamondScorebookError('invalid-response', 'The private scorebook history exceeded its requested boundary.');
    }
    items.push(...page.items);
    afterSequence = lastSequence;

    if (afterSequence < requestedEnd) {
      if (page.collectionComplete || page.nextCursor !== String(afterSequence)) {
        throw new DiamondScorebookError(
          'invalid-response',
          'The private scorebook history ended before the requested window was complete.'
        );
      }
      continue;
    }

    const reachesHead = requestedEnd === expectedRevision;
    if (
      (reachesHead && (!page.collectionComplete || page.nextCursor !== null)) ||
      (!reachesHead && (page.collectionComplete || page.nextCursor !== String(requestedEnd)))
    ) {
      throw new DiamondScorebookError('invalid-response', 'The private scorebook window returned inconsistent head evidence.');
    }
  }

  if (items.length !== requestedEnd - requestedStart + 1) {
    throw new DiamondScorebookError('invalid-response', 'The private scorebook history window is incomplete.');
  }
  const oldestSequence = items[0]!.sequence;
  const newestSequence = items[items.length - 1]!.sequence;
  const window: DiamondPrivateHistoryWindow = {
    sourceRevision: expectedRevision,
    oldestSequence,
    newestSequence,
    contiguous: true,
    rangeComplete: true,
    headComplete: newestSequence === expectedRevision,
    historyComplete: oldestSequence === 1 && newestSequence === expectedRevision,
    hasOlder: oldestSequence > 1,
    items
  };
  assertPrivateHistoryWindowEvidence(window, 'The private scorebook history window');
  return window;
}

/** Combine an older verified block with the currently loaded contiguous head. */
export function mergeDiamondPrivateHistoryWindows(
  current: DiamondPrivateHistoryWindow,
  older: DiamondPrivateHistoryWindow
): DiamondPrivateHistoryWindow {
  assertPrivateHistoryWindowEvidence(current, 'The current private scorebook history window');
  assertPrivateHistoryWindowEvidence(older, 'The older private scorebook history window');
  if (current.sourceRevision !== older.sourceRevision || !current.headComplete || current.oldestSequence === null) {
    throw new DiamondScorebookError('stale-revision', 'Private scorebook history windows do not share one authoritative head.', {
      authoritativeRevision: older.sourceRevision
    });
  }
  if (older.newestSequence === null || older.newestSequence + 1 !== current.oldestSequence) {
    throw new DiamondScorebookError('invalid-response', 'Private scorebook history windows are not adjacent.');
  }
  const items = [...older.items, ...current.items];
  const oldestSequence = older.oldestSequence;
  const newestSequence = current.newestSequence;
  const merged: DiamondPrivateHistoryWindow = {
    sourceRevision: current.sourceRevision,
    oldestSequence,
    newestSequence,
    contiguous: true,
    rangeComplete: true,
    headComplete: true,
    historyComplete: oldestSequence === 1 && newestSequence === current.sourceRevision,
    hasOlder: oldestSequence !== null && oldestSequence > 1,
    items
  };
  assertPrivateHistoryWindowEvidence(merged, 'The combined private scorebook history window');
  return merged;
}

function diamondAiStaleError(source: Record<string, unknown>, fallbackRevision: number) {
  return new DiamondScorebookError(
    'stale-revision',
    'The game changed after this AI source was prepared. Generate a new draft from the current final scorebook.',
    {
      authoritativeRevision:
        normalizeOptionalRevision(source.currentRevision ?? source.authoritativeRevision ?? source.sourceRevision) ?? fallbackRevision
    }
  );
}

export async function getDiamondRecapSource(
  input: { teamId: string; gameId: string; sourceRevision: number },
  options: { transport?: DiamondCallableTransport } = {}
): Promise<DiamondRecapSource> {
  const payload = {
    teamId: requireResourceId(input.teamId, 'Team ID'),
    gameId: requireResourceId(input.gameId, 'Game ID'),
    sourceRevision: requireRevision(input.sourceRevision, 'Source revision')
  };
  try {
    const raw = await callWithRetry<unknown>(
      options.transport || defaultTransport,
      'getDiamondRecapSource',
      payload,
      'Unable to load a source-cited Diamond recap packet.'
    );
    const source = asRecord(raw);
    const returnedRevision = normalizeOptionalRevision(source.sourceRevision);
    if (source.current === false || (returnedRevision !== null && returnedRevision !== payload.sourceRevision)) {
      throw diamondAiStaleError(source, payload.sourceRevision);
    }
    requireExactResponseKeys(source, ['current', 'sourceRevision', 'checkpointHash', 'packet'], 'Diamond AI recap source');
    if (source.current !== true || returnedRevision === null) {
      throw new DiamondScorebookError('invalid-response', 'The server did not confirm a current Diamond AI recap source.');
    }
    const checkpointHash = requireCheckpointHash(source.checkpointHash);
    let packet: DiamondAiSourcePacket;
    try {
      packet = normalizeDiamondAiSourcePacket(source.packet);
    } catch (error) {
      throw new DiamondScorebookError('invalid-response', 'The server returned an unsafe or malformed Diamond AI source packet.', {
        cause: error
      });
    }
    if (packet.sourceRevision !== payload.sourceRevision) {
      throw diamondAiStaleError({ sourceRevision: packet.sourceRevision }, payload.sourceRevision);
    }
    return { current: true, sourceRevision: returnedRevision, checkpointHash, packet };
  } catch (error) {
    throw toDiamondError(error, 'Unable to load a source-cited Diamond recap packet.');
  }
}

export async function publishDiamondAiDraft(
  input: {
    requestId: string;
    teamId: string;
    gameId: string;
    sourceRevision: number;
    checkpointHash: string;
    draft: DiamondAiGameDraft;
  },
  options: { transport?: DiamondCallableTransport } = {}
): Promise<DiamondAiPublicationEvidence> {
  const sourceRevision = requireRevision(input.sourceRevision, 'Source revision');
  let draft: DiamondAiGameDraft;
  try {
    draft = normalizeDiamondAiDraftForPublication(input.draft, sourceRevision);
  } catch (error) {
    throw new DiamondScorebookError('invalid-input', 'The AI draft is unsafe, malformed, or no longer revision-pinned.', {
      cause: error
    });
  }
  const payload = {
    requestId: requireSecureRequestId(input.requestId),
    teamId: requireResourceId(input.teamId, 'Team ID'),
    gameId: requireResourceId(input.gameId, 'Game ID'),
    sourceRevision,
    checkpointHash: requireCheckpointHash(input.checkpointHash, 'invalid-input'),
    draft
  };
  try {
    const raw = await callWithRetry<unknown>(
      options.transport || defaultTransport,
      'publishDiamondAiDraft',
      payload,
      'Unable to confirm publication of the Diamond AI draft.'
    );
    const source = asRecord(raw);
    const returnedRevision = normalizeOptionalRevision(source.sourceRevision);
    if (
      source.stale === true ||
      source.status === 'stale' ||
      source.current === false ||
      (returnedRevision !== null && returnedRevision !== payload.sourceRevision)
    ) {
      throw diamondAiStaleError(source, payload.sourceRevision);
    }
    requireExactResponseKeys(
      source,
      ['published', 'current', 'sourceRevision', 'checkpointHash', 'publicationId', 'publishedAt'],
      'Diamond AI publication'
    );
    if (source.current !== true || returnedRevision === null) {
      throw new DiamondScorebookError('invalid-response', 'The server did not confirm a current Diamond AI publication.');
    }
    const checkpointHash = requireCheckpointHash(source.checkpointHash);
    if (checkpointHash !== payload.checkpointHash) {
      throw diamondAiStaleError(source, payload.sourceRevision);
    }
    if (source.published !== true) {
      throw new DiamondScorebookError('invalid-response', 'The server did not confirm that the Diamond AI draft was published.');
    }
    return {
      published: true,
      current: true,
      sourceRevision: returnedRevision,
      checkpointHash,
      publicationId: requirePublicationId(source.publicationId),
      publishedAt: requireIsoTimestamp(source.publishedAt)
    };
  } catch (error) {
    throw toDiamondError(error, 'Unable to confirm publication of the Diamond AI draft.');
  }
}

export async function submitDiamondCommand(
  command: DiamondCommandEnvelope,
  options: { transport?: DiamondCallableTransport; maxAttempts?: number } = {}
): Promise<DiamondCommandOutcome> {
  const validatedCommand = normalizeCommand(command);
  try {
    const result = await callWithRetry<unknown>(
      options.transport || defaultTransport,
      'submitDiamondCommand',
      validatedCommand,
      'Unable to confirm the scorebook action.',
      options.maxAttempts ?? 2
    );
    return normalizeCommandOutcome(result, validatedCommand);
  } catch (error) {
    throw toDiamondError(error, 'Unable to confirm the scorebook action.');
  }
}

export async function cancelDiamondGame(
  input: {
    teamId: string;
    gameId: string;
    reason: string;
    appBuild?: number | string;
  },
  options: {
    transport?: DiamondCallableTransport;
    crypto?: SecureCrypto | null;
    appBuildResolver?: DiamondAppBuildResolver;
  } = {}
): Promise<DiamondCommandOutcome> {
  const reason = compactText(input.reason).replace(/\s+/g, ' ');
  if (!reason || reason.length > 300) {
    throw new DiamondScorebookError('invalid-input', 'A cancellation reason of at most 300 characters is required.');
  }
  const teamId = requireResourceId(input.teamId, 'Team ID');
  const gameId = requireResourceId(input.gameId, 'Game ID');
  const appBuild = await resolveRequestedAppBuild(input.appBuild, options.appBuildResolver);
  const snapshot = await getDiamondState(teamId, gameId, { transport: options.transport });
  if (!snapshot.authoritative) {
    throw new DiamondScorebookError(
      'unavailable',
      'The current Diamond revision could not be verified. Refresh before cancelling this game.',
      { retryable: true, authoritativeRevision: snapshot.revision }
    );
  }
  if (snapshot.lifecycle === 'cancelled') {
    return {
      outcome: 'duplicate',
      revision: snapshot.revision,
      eventId: null,
      snapshot,
      completeness: snapshot.completeness
    };
  }
  const command = createDiamondCommand(
    {
      teamId,
      gameId,
      appBuild,
      expectedInstanceId: snapshot.instanceId,
      expectedRevision: snapshot.revision,
      rulesProfileId: snapshot.rulesProfileId,
      rulesProfileVersion: snapshot.rulesProfileVersion,
      type: 'cancel',
      payload: { confirmed: true, reason }
    },
    options.crypto
  );
  try {
    return await submitDiamondCommand(command, { transport: options.transport });
  } catch (error) {
    if (!(error instanceof DiamondScorebookError) || !error.retryable) throw error;
    try {
      const reconciled = await getDiamondState(teamId, gameId, { transport: options.transport });
      if (
        reconciled.authoritative &&
        reconciled.instanceId === snapshot.instanceId &&
        reconciled.lifecycle === 'cancelled' &&
        reconciled.revision > snapshot.revision
      ) {
        return {
          outcome: 'duplicate',
          revision: reconciled.revision,
          eventId: null,
          snapshot: reconciled,
          completeness: reconciled.completeness
        };
      }
    } catch {
      // Preserve the original ambiguous command result when reconciliation is
      // unavailable or cannot prove that this exact game instance advanced.
    }
    throw error;
  }
}

function normalizeCommand(value: unknown): DiamondCommandEnvelope {
  const source = asRecord(value);
  const type = compactText(source.type) as DiamondCommandType;
  if (source.schemaVersion !== 2 || !diamondCommandTypes.has(type)) {
    throw new DiamondScorebookError('invalid-input', 'Diamond command schema is invalid.');
  }
  const commandId = requireResourceId(source.commandId, 'Command ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)) {
    throw new DiamondScorebookError('invalid-input', 'Command ID must be a secure UUID.');
  }
  return {
    schemaVersion: 2,
    commandId: commandId.toLowerCase(),
    teamId: requireResourceId(source.teamId, 'Team ID'),
    gameId: requireResourceId(source.gameId, 'Game ID'),
    appBuild: requireAppBuild(source.appBuild),
    expectedInstanceId: requireDiamondInstanceId(source.expectedInstanceId, 'invalid-input'),
    ...(source.leaseId ? { leaseId: requireScorerLeaseId(source.leaseId) } : {}),
    expectedRevision: requireRevision(source.expectedRevision),
    rulesProfileId: requireResourceId(source.rulesProfileId, 'Rules profile ID'),
    rulesProfileVersion: requirePositiveVersion(source.rulesProfileVersion),
    type,
    payload: cloneJsonObject(source.payload || {})
  };
}

export async function parseDiamondVoice(
  input: {
    teamId: string;
    gameId: string;
    expectedRevision: number;
    rulesProfileId: string;
    rulesProfileVersion: number;
    transcript: string;
  },
  options: { transport?: DiamondCallableTransport } = {}
): Promise<DiamondVoiceProposal> {
  const transcript = compactText(input.transcript).replace(/\s+/g, ' ');
  if (!transcript || transcript.length > 2000) {
    throw new DiamondScorebookError('invalid-input', 'Dictation must be between 1 and 2,000 characters.');
  }
  const payload = {
    teamId: requireResourceId(input.teamId, 'Team ID'),
    gameId: requireResourceId(input.gameId, 'Game ID'),
    expectedRevision: requireRevision(input.expectedRevision),
    rulesProfileId: requireResourceId(input.rulesProfileId, 'Rules profile ID'),
    rulesProfileVersion: requirePositiveVersion(input.rulesProfileVersion),
    transcript
  };
  try {
    const raw = await callWithRetry<unknown>(
      options.transport || defaultTransport,
      'parseDiamondVoice',
      payload,
      'Unable to interpret this dictation.'
    );
    const source = asRecord(raw);
    const type = compactText(source.type) as DiamondCommandType;
    if (
      source.schemaVersion !== 1 ||
      !voiceProposalCommandTypes.has(type) ||
      source.requiresConfirmation !== true ||
      source.mutatesState !== false ||
      containsSensitiveQueueFields(cloneJsonObject(source.payload || {}))
    ) {
      throw new DiamondScorebookError('invalid-response', 'The AI proposal did not preserve the required confirmation boundary.');
    }
    const confidence = Number(source.confidence);
    return {
      schemaVersion: 1,
      type,
      payload: cloneJsonObject(source.payload || {}),
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      unresolvedFields: Array.isArray(source.unresolvedFields) ? source.unresolvedFields.map(compactText).filter(Boolean).slice(0, 20) : [],
      requiresConfirmation: true,
      mutatesState: false
    };
  } catch (error) {
    throw toDiamondError(error, 'Unable to interpret this dictation.');
  }
}

export async function saveDiamondPrivateNote(
  input: {
    teamId: string;
    gameId: string;
    appBuild: number;
    expectedInstanceId: string;
    leaseId?: string | null;
    expectedRevision: number;
    rulesProfileId: string;
    rulesProfileVersion: number;
    text: string;
    attachedEventId?: string | null;
  },
  options: { transport?: DiamondCallableTransport; crypto?: SecureCrypto | null } = {}
) {
  const text = compactText(input.text).replace(/\s+/g, ' ');
  if (!text || text.length > 2000) {
    throw new DiamondScorebookError('invalid-input', 'Private note text must be between 1 and 2,000 characters.');
  }
  const attachedEventId = input.attachedEventId ? requireResourceId(input.attachedEventId, 'Event ID') : '';
  const command = createDiamondCommand(
    {
      teamId: input.teamId,
      gameId: input.gameId,
      appBuild: input.appBuild,
      expectedInstanceId: input.expectedInstanceId,
      leaseId: input.leaseId,
      expectedRevision: input.expectedRevision,
      rulesProfileId: input.rulesProfileId,
      rulesProfileVersion: input.rulesProfileVersion,
      type: 'private_note',
      payload: {
        text,
        ...(attachedEventId ? { attachedEventId } : {})
      }
    },
    options.crypto
  );
  return submitDiamondCommand(command, { transport: options.transport });
}

export async function requestDiamondScorerHandoff(
  input: {
    teamId: string;
    gameId: string;
    appBuild: number;
    expectedInstanceId: string;
    leaseId?: string | null;
    expectedRevision: number;
    rulesProfileId: string;
    rulesProfileVersion: number;
    toUid: string;
  },
  options: { transport?: DiamondCallableTransport; crypto?: SecureCrypto | null } = {}
) {
  const command = createDiamondCommand(
    {
      teamId: input.teamId,
      gameId: input.gameId,
      appBuild: input.appBuild,
      expectedInstanceId: input.expectedInstanceId,
      leaseId: input.leaseId,
      expectedRevision: input.expectedRevision,
      rulesProfileId: input.rulesProfileId,
      rulesProfileVersion: input.rulesProfileVersion,
      type: 'scorer_handoff',
      payload: { toUid: requireResourceId(input.toUid, 'Scorekeeper ID') }
    },
    options.crypto
  );
  return submitDiamondCommand(command, { transport: options.transport });
}

export async function getDiamondAccess(
  teamId: string,
  options: {
    gameId?: string;
    appBuild?: number | string;
    appBuildResolver?: DiamondAppBuildResolver;
    transport?: DiamondCallableTransport;
  } = {}
): Promise<DiamondAccess> {
  const payload: Record<string, unknown> = {
    teamId: requireResourceId(teamId, 'Team ID'),
    appBuild: await resolveRequestedAppBuild(options.appBuild, options.appBuildResolver)
  };
  if (options.gameId) payload.gameId = requireResourceId(options.gameId, 'Game ID');
  try {
    const raw = await callWithRetry<unknown>(
      options.transport || defaultTransport,
      'getDiamondAccess',
      payload,
      'Unable to verify diamond scorebook access.'
    );
    const source = asRecord(raw);
    const policyMode = compactText(source.policyMode);
    const sport = compactText(source.sport).toLowerCase();
    const engine = compactText(source.trackingEngine);
    return {
      eligible: source.eligible === true,
      canManage: source.canManage === true,
      canScore: source.canScore === true,
      policyMode: ['internal', 'pilot', 'enabled'].includes(policyMode) ? (policyMode as DiamondAccess['policyMode']) : 'disabled',
      sport: sport === 'baseball' || sport === 'fastpitch' ? sport : null,
      teamOptIn: source.teamOptIn === true,
      trackingEngine: engine === 'diamond-v2' || engine === 'legacy' ? engine : null,
      reason: compactText(source.reason) || null
    };
  } catch (error) {
    throw toDiamondError(error, 'Unable to verify diamond scorebook access.');
  }
}

export async function configureDiamondTeam(
  teamId: string,
  sport: DiamondSport,
  rulesProfileId?: string | null,
  options: {
    enabled?: boolean;
    rulesProfileVersion?: number;
    captureMode?: DiamondCaptureMode;
    appBuild?: number | string;
    appBuildResolver?: DiamondAppBuildResolver;
    transport?: DiamondCallableTransport;
    crypto?: SecureCrypto | null;
  } = {}
): Promise<DiamondTeamConfiguration> {
  if (sport !== 'baseball' && sport !== 'fastpitch') {
    throw new DiamondScorebookError('invalid-input', 'Diamond scorebook setup supports Baseball or Fastpitch.');
  }
  const selectedRulesProfileId = rulesProfileId || `${sport}-youth`;
  const captureMode: DiamondCaptureMode = options.captureMode === 'full' ? 'full' : 'quick';
  const payload = {
    requestId: createSecureDiamondId(options.crypto === undefined ? globalThis.crypto : options.crypto),
    teamId: requireResourceId(teamId, 'Team ID'),
    appBuild: await resolveRequestedAppBuild(options.appBuild, options.appBuildResolver),
    // Omission must never enroll a team. Callers have to opt in explicitly.
    enabled: options.enabled === true,
    sport,
    rulesProfileId: requireResourceId(selectedRulesProfileId, 'Rules profile ID'),
    rulesProfileVersion: requirePositiveVersion(options.rulesProfileVersion ?? 1),
    captureMode
  };
  try {
    const raw = await callWithRetry<unknown>(
      options.transport || defaultTransport,
      'configureDiamondTeam',
      payload,
      'Unable to configure this team for diamond scoring.'
    );
    const source = asRecord(raw);
    if (source.configured !== true) throw new DiamondScorebookError('invalid-response', 'Team setup was not confirmed.');
    if (typeof source.enabled !== 'boolean' || source.enabled !== payload.enabled) {
      throw new DiamondScorebookError('invalid-response', 'Team setup did not confirm the requested Diamond activation state.');
    }
    const returnedTeamId = requireResourceId(source.teamId, 'Team ID');
    const returnedRulesProfileId = requireResourceId(source.rulesProfileId, 'Rules profile ID');
    const returnedRulesProfileVersion = requirePositiveVersion(source.rulesProfileVersion);
    const returnedCaptureMode = source.captureMode === 'full' ? 'full' : source.captureMode === 'quick' ? 'quick' : null;
    if (
      returnedTeamId !== payload.teamId ||
      source.sport !== sport ||
      returnedRulesProfileId !== payload.rulesProfileId ||
      returnedRulesProfileVersion !== payload.rulesProfileVersion ||
      returnedCaptureMode !== payload.captureMode
    ) {
      throw new DiamondScorebookError('invalid-response', 'Team setup did not confirm the requested Diamond configuration.');
    }
    return {
      configured: true,
      enabled: source.enabled,
      teamId: returnedTeamId,
      sport,
      rulesProfileId: returnedRulesProfileId,
      rulesProfileVersion: returnedRulesProfileVersion,
      captureMode: returnedCaptureMode
    };
  } catch (error) {
    throw toDiamondError(error, 'Unable to configure this team for diamond scoring.');
  }
}

export async function activateDiamondGame(
  input: {
    teamId: string;
    gameId: string;
    captureMode: DiamondCaptureMode;
    appBuild?: number | string;
  },
  options: {
    appBuildResolver?: DiamondAppBuildResolver;
    transport?: DiamondCallableTransport;
    crypto?: SecureCrypto | null;
  } = {}
): Promise<DiamondGameActivation> {
  const payload = {
    requestId: createSecureDiamondId(options.crypto === undefined ? globalThis.crypto : options.crypto),
    teamId: requireResourceId(input.teamId, 'Team ID'),
    gameId: requireResourceId(input.gameId, 'Game ID'),
    appBuild: await resolveRequestedAppBuild(input.appBuild, options.appBuildResolver),
    captureMode: input.captureMode === 'full' ? 'full' : 'quick'
  };
  try {
    const raw = await callWithRetry<unknown>(
      options.transport || defaultTransport,
      'activateDiamondGame',
      payload,
      'Unable to activate this diamond scorebook.'
    );
    const source = asRecord(raw);
    if (source.activated !== true || compactText(source.trackingEngine) !== 'diamond-v2') {
      throw new DiamondScorebookError('invalid-response', 'Game activation was not confirmed.');
    }
    const snapshotValue = source.state || source.snapshot;
    return {
      activated: true,
      teamId: payload.teamId,
      gameId: payload.gameId,
      trackingEngine: 'diamond-v2',
      snapshot: snapshotValue ? normalizeDiamondSnapshot(snapshotValue) : null
    };
  } catch (error) {
    throw toDiamondError(error, 'Unable to activate this diamond scorebook.');
  }
}

export async function acquireDiamondScorerLease(
  input: {
    teamId: string;
    gameId: string;
    expectedInstanceId: string;
    expectedRevision: number;
    operation: 'acquire' | 'recover';
    targetUid?: string | null;
    appBuild?: number | string;
  },
  options: {
    appBuildResolver?: DiamondAppBuildResolver;
    transport?: DiamondCallableTransport;
    crypto?: SecureCrypto | null;
    maxAttempts?: number;
  } = {}
): Promise<DiamondScorerLeaseOutcome> {
  if (input.operation !== 'acquire' && input.operation !== 'recover') {
    throw new DiamondScorebookError('invalid-input', 'Choose acquire or recover for the scorer lease.');
  }
  const payload = {
    requestId: createSecureDiamondId(options.crypto === undefined ? globalThis.crypto : options.crypto),
    teamId: requireResourceId(input.teamId, 'Team ID'),
    gameId: requireResourceId(input.gameId, 'Game ID'),
    appBuild: await resolveRequestedAppBuild(input.appBuild, options.appBuildResolver),
    expectedInstanceId: requireDiamondInstanceId(input.expectedInstanceId, 'invalid-input'),
    expectedRevision: requireRevision(input.expectedRevision),
    operation: input.operation,
    ...(input.targetUid ? { targetUid: requireResourceId(input.targetUid, 'Scorekeeper ID') } : {})
  };
  try {
    const raw = await callWithRetry<unknown>(
      options.transport || defaultTransport,
      'acquireDiamondScorerLease',
      payload,
      'Unable to confirm the scorer lease change.',
      options.maxAttempts ?? 2
    );
    const source = asRecord(raw);
    const outcome = compactText(source.outcome);
    const operation = compactText(source.operation);
    const revision = normalizeOptionalRevision(source.revision);
    if (
      (outcome !== 'accepted' && outcome !== 'duplicate') ||
      operation !== payload.operation ||
      revision === null ||
      revision <= payload.expectedRevision
    ) {
      throw new DiamondScorebookError('invalid-response', 'The server did not confirm the scorer lease change.');
    }
    const snapshotValue = source.state || source.snapshot;
    if (!snapshotValue) {
      throw new DiamondScorebookError('invalid-response', 'The server omitted the authoritative scorer lease state.');
    }
    const snapshot = normalizeDiamondSnapshot({ ...asRecord(snapshotValue), revision });
    if (snapshot.instanceId !== payload.expectedInstanceId) {
      throw new DiamondScorebookError('invalid-response', 'The scorer lease response belongs to another game instance.');
    }
    const targetUid = payload.targetUid || snapshot.lease.holderUid;
    if (outcome === 'accepted' && targetUid && snapshot.lease.holderUid !== targetUid) {
      throw new DiamondScorebookError('invalid-response', 'The scorer lease response named a different holder.');
    }
    return {
      outcome,
      operation: payload.operation,
      revision,
      eventId: compactText(source.eventId) || null,
      snapshot
    };
  } catch (error) {
    throw toDiamondError(error, 'Unable to confirm the scorer lease change.');
  }
}

function normalizeQueueIdentity(value: DiamondQueueIdentity): DiamondQueueIdentity {
  const source = asRecord(value);
  const identity = {
    teamId: requireResourceId(source.teamId, 'Team ID'),
    gameId: requireResourceId(source.gameId, 'Game ID'),
    authenticatedUid: requireResourceId(source.authenticatedUid, 'Authenticated user ID'),
    scorerUid: requireResourceId(source.scorerUid, 'Scorer ID'),
    instanceId: requireDiamondInstanceId(source.instanceId, 'invalid-input'),
    leaseId: requireScorerLeaseId(source.leaseId)
  };
  if (identity.authenticatedUid !== identity.scorerUid) {
    throw new DiamondScorebookError(
      'permission-denied',
      'The offline queue is available only to the signed-in user who currently owns the scorebook.'
    );
  }
  return identity;
}

function queueIdentitiesMatch(left: DiamondQueueIdentity, right: DiamondQueueIdentity) {
  return (
    left.teamId === right.teamId &&
    left.gameId === right.gameId &&
    left.authenticatedUid === right.authenticatedUid &&
    left.scorerUid === right.scorerUid &&
    left.instanceId === right.instanceId &&
    left.leaseId === right.leaseId
  );
}

function queuedCommandMatchesIdentity(item: DiamondQueuedCommand, identity: DiamondQueueIdentity) {
  return (
    item.command.teamId === identity.teamId &&
    item.command.gameId === identity.gameId &&
    item.command.expectedInstanceId === identity.instanceId &&
    item.authenticatedUid === identity.authenticatedUid &&
    item.scorerUid === identity.scorerUid &&
    item.instanceId === identity.instanceId &&
    item.leaseId === identity.leaseId &&
    item.command.leaseId === identity.leaseId
  );
}

export function getDiamondQueueKey(identityValue: DiamondQueueIdentity) {
  const identity = normalizeQueueIdentity(identityValue);
  const scope = [identity.teamId, identity.gameId, identity.instanceId, identity.authenticatedUid, identity.leaseId]
    .map((part) => encodeURIComponent(part))
    .join(':');
  return `${queuePrefix}:${scope}`;
}

function getLegacyDiamondQueueKeys(identity: DiamondQueueIdentity) {
  const legacyScope = `${encodeURIComponent(identity.teamId)}:${encodeURIComponent(identity.gameId)}`;
  const v2Scope = [identity.teamId, identity.gameId, identity.instanceId, identity.authenticatedUid]
    .map((part) => encodeURIComponent(part))
    .join(':');
  return [`${legacyQueuePrefixes[0]}:${legacyScope}`, `${legacyQueuePrefixes[1]}:${v2Scope}`];
}

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function containsSensitiveQueueFields(value: DiamondJsonValue, key = ''): boolean {
  if (/(audio|recording|transcript|private.?note)/i.test(key)) return true;
  if (
    typeof value === 'string' &&
    /\b(?:raw[ _-]?(?:audio|transcript)|audio[ _-]?(?:data|recording)|private[ _-]?notes?|transcript)\b/i.test(value)
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveQueueFields(entry));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([entryKey, entry]) => containsSensitiveQueueFields(entry, entryKey));
  }
  return false;
}

export function readDiamondCommandQueue(
  identityValue: DiamondQueueIdentity,
  storage: StorageLike | null = getDefaultStorage()
): DiamondQueuedCommand[] {
  if (!storage) return [];
  const identity = normalizeQueueIdentity(identityValue);
  const key = getDiamondQueueKey(identity);
  const discardUnsafeQueue = () => {
    try {
      storage.removeItem(key);
    } catch {
      // A queue that cannot be removed remains fail-closed because this read
      // returns no commands and reconciliation therefore submits nothing.
    }
    return [];
  };
  try {
    // V1 had no user or scorebook-generation binding and V2 had no durable
    // scorer-lease binding. Neither can be safely replayed into this lease.
    getLegacyDiamondQueueKeys(identity).forEach((legacyKey) => storage.removeItem(legacyKey));
    const parsed = JSON.parse(storage.getItem(key) || 'null');
    if (!parsed) return [];
    if (parsed.version !== queueVersion || !Array.isArray(parsed.items)) return discardUnsafeQueue();
    let storedIdentity: DiamondQueueIdentity;
    try {
      storedIdentity = normalizeQueueIdentity(asRecord(parsed.identity) as DiamondQueueIdentity);
    } catch {
      return discardUnsafeQueue();
    }
    if (!queueIdentitiesMatch(storedIdentity, identity) || parsed.items.length > maxQueueCommands) {
      return discardUnsafeQueue();
    }
    const items: DiamondQueuedCommand[] = [];
    for (const entry of parsed.items) {
      const source = asRecord(entry);
      try {
        const command = normalizeCommand(source.command);
        const queuedAt = compactText(source.queuedAt);
        const itemIdentity = normalizeQueueIdentity({
          teamId: command.teamId,
          gameId: command.gameId,
          authenticatedUid: source.authenticatedUid as string,
          scorerUid: source.scorerUid as string,
          instanceId: source.instanceId as string,
          leaseId: source.leaseId as string
        });
        if (
          !queueIdentitiesMatch(itemIdentity, identity) ||
          command.expectedInstanceId !== identity.instanceId ||
          command.leaseId !== identity.leaseId ||
          command.type === 'private_note' ||
          containsSensitiveQueueFields(command.payload) ||
          !queuedAt ||
          queuedAt.length > 64 ||
          !Number.isFinite(Date.parse(queuedAt))
        ) {
          return discardUnsafeQueue();
        }
        items.push({ command, queuedAt, ...itemIdentity });
      } catch {
        return discardUnsafeQueue();
      }
    }
    return items;
  } catch {
    return [];
  }
}

function writeDiamondCommandQueue(identityValue: DiamondQueueIdentity, items: DiamondQueuedCommand[], storage: StorageLike | null) {
  if (!storage) {
    throw new DiamondScorebookError(
      'storage-unavailable',
      'This device cannot safely retain an offline scoring queue. Reconnect before scoring.'
    );
  }
  const identity = normalizeQueueIdentity(identityValue);
  const key = getDiamondQueueKey(identity);
  if (items.length === 0) {
    try {
      storage.removeItem(key);
      return;
    } catch (error) {
      throw new DiamondScorebookError('storage-unavailable', 'The completed offline queue could not be cleared safely.', { cause: error });
    }
  }
  if (items.length > maxQueueCommands) {
    throw new DiamondScorebookError('storage-unavailable', 'The offline scorebook queue is full. Reconnect before recording more plays.');
  }
  if (items.some((item) => !queuedCommandMatchesIdentity(item, identity))) {
    throw new DiamondScorebookError('conflict', 'The offline queue contains commands from another user or game instance.');
  }
  const serialized = JSON.stringify({ version: queueVersion, identity, items });
  if (serialized.length > maxQueueBytes) {
    throw new DiamondScorebookError(
      'storage-unavailable',
      'The offline scorebook queue is too large. Reconnect before recording more plays.'
    );
  }
  try {
    storage.setItem(key, serialized);
  } catch (error) {
    throw new DiamondScorebookError(
      'storage-unavailable',
      'This device could not save the offline scoring queue. Reconnect before scoring.',
      { cause: error }
    );
  }
}

export function enqueueDiamondCommand(
  commandValue: DiamondCommandEnvelope,
  identityValue: DiamondQueueIdentity,
  storage: StorageLike | null = getDefaultStorage(),
  now: () => Date = () => new Date()
) {
  const command = normalizeCommand(commandValue);
  const identity = normalizeQueueIdentity(identityValue);
  if (
    command.teamId !== identity.teamId ||
    command.gameId !== identity.gameId ||
    command.expectedInstanceId !== identity.instanceId ||
    command.leaseId !== identity.leaseId
  ) {
    throw new DiamondScorebookError('conflict', 'This command belongs to a different game than the active offline queue.');
  }
  if (command.type === 'private_note' || containsSensitiveQueueFields(command.payload)) {
    throw new DiamondScorebookError(
      'storage-unavailable',
      'Private notes and raw dictation are never stored in the offline scoring queue. Reconnect to save this note.'
    );
  }
  const items = readDiamondCommandQueue(identity, storage);
  const existing = items.find((entry) => entry.command.commandId === command.commandId);
  if (existing) {
    if (JSON.stringify(existing.command) !== JSON.stringify(command)) {
      throw new DiamondScorebookError('conflict', 'This command ID is already queued with different play details.');
    }
    return items;
  }
  const next = [...items, { command, queuedAt: now().toISOString(), ...identity }];
  writeDiamondCommandQueue(identity, next, storage);
  return next;
}

export async function reconcileDiamondCommandQueue(
  identityValue: DiamondQueueIdentity,
  options: { storage?: StorageLike | null; transport?: DiamondCallableTransport } = {}
): Promise<DiamondQueueReconciliation> {
  const identity = normalizeQueueIdentity(identityValue);
  const storage = options.storage === undefined ? getDefaultStorage() : options.storage;
  let remaining = readDiamondCommandQueue(identity, storage);
  let accepted = 0;
  let duplicates = 0;
  let lastSnapshot: DiamondScorebookSnapshot | null = null;
  if (remaining.length > 0) {
    const current = await getDiamondState(identity.teamId, identity.gameId, { transport: options.transport });
    if (
      current.instanceId !== identity.instanceId ||
      !current.lease.canScore ||
      current.lease.holderUid !== identity.scorerUid ||
      current.lease.leaseId !== identity.leaseId ||
      identity.authenticatedUid !== identity.scorerUid
    ) {
      throw new DiamondScorebookError(
        'conflict',
        'Queued plays belong to another signed-in scorer or Diamond game instance and remain quarantined on this device.'
      );
    }
  }
  while (remaining.length > 0) {
    const current = remaining[0]!;
    const result = await submitDiamondCommand(current.command, { transport: options.transport });
    if (result.outcome === 'duplicate') duplicates += 1;
    else accepted += 1;
    lastSnapshot = result.snapshot || lastSnapshot;
    remaining = remaining.slice(1);
    writeDiamondCommandQueue(identity, remaining, storage);
    if (
      remaining.length > 0 &&
      result.snapshot &&
      (result.snapshot.instanceId !== identity.instanceId ||
        !result.snapshot.lease.canScore ||
        result.snapshot.lease.holderUid !== identity.scorerUid ||
        result.snapshot.lease.leaseId !== identity.leaseId)
    ) {
      throw new DiamondScorebookError(
        'conflict',
        'The scoring lease or Diamond game instance changed during reconciliation. Remaining commands were not submitted.'
      );
    }
  }
  return { accepted, duplicates, remaining, lastSnapshot };
}

export type DiamondScorebookClient = {
  load: typeof getDiamondState;
  loadPrivateHistoryWindow: typeof getDiamondPrivateHistoryWindow;
  resolveAppBuild: typeof resolveDiamondAppBuild;
  getRecapSource: typeof getDiamondRecapSource;
  publishAiDraft: typeof publishDiamondAiDraft;
  createSecureId: typeof createSecureDiamondId;
  createCommand: typeof createDiamondCommand;
  acquireLease: typeof acquireDiamondScorerLease;
  listScorerCandidates: typeof listDiamondScorerCandidates;
  submitCommand: typeof submitDiamondCommand;
  cancelGame: typeof cancelDiamondGame;
  parseVoice: typeof parseDiamondVoice;
  savePrivateNote: typeof saveDiamondPrivateNote;
  requestHandoff: typeof requestDiamondScorerHandoff;
  readQueue: typeof readDiamondCommandQueue;
  enqueue: typeof enqueueDiamondCommand;
  reconcileQueue: typeof reconcileDiamondCommandQueue;
};

export const diamondScorebookClient: DiamondScorebookClient = {
  load: getDiamondState,
  loadPrivateHistoryWindow: getDiamondPrivateHistoryWindow,
  resolveAppBuild: resolveDiamondAppBuild,
  getRecapSource: getDiamondRecapSource,
  publishAiDraft: publishDiamondAiDraft,
  createSecureId: createSecureDiamondId,
  createCommand: createDiamondCommand,
  acquireLease: acquireDiamondScorerLease,
  listScorerCandidates: listDiamondScorerCandidates,
  submitCommand: submitDiamondCommand,
  cancelGame: cancelDiamondGame,
  parseVoice: parseDiamondVoice,
  savePrivateNote: saveDiamondPrivateNote,
  requestHandoff: requestDiamondScorerHandoff,
  readQueue: readDiamondCommandQueue,
  enqueue: enqueueDiamondCommand,
  reconcileQueue: reconcileDiamondCommandQueue
};
