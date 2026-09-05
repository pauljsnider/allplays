import { functions, httpsCallable } from './adapters/legacyParentTools';
import { getDiamondRulesProfile } from './diamondScorebook';
import { callNativeFirebaseFunction } from './nativeCallable';
import { isNativeRuntime } from './nativeRuntime';

export type DiamondSport = 'baseball' | 'fastpitch';
export type DiamondCaptureMode = 'quick' | 'full';
export type DiamondHalf = 'top' | 'bottom';
export type DiamondCoverageStatus = 'complete' | 'partial' | 'not_collected';
export type DiamondLifecycle = 'configured' | 'ready' | 'active' | 'suspended' | 'final' | 'correction';

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
  | 'finalize';

export type DiamondJsonValue = string | number | boolean | null | DiamondJsonValue[] | { [key: string]: DiamondJsonValue };
export type DiamondJsonObject = { [key: string]: DiamondJsonValue };

export type DiamondPlayerRef = {
  playerId: string;
  name: string;
  number?: string | null;
};

export type DiamondBaseState = {
  first: DiamondPlayerRef | null;
  second: DiamondPlayerRef | null;
  third: DiamondPlayerRef | null;
};

export type DiamondLineupEntry = DiamondPlayerRef & {
  slot: number;
  active?: boolean;
  battingRole?: string | null;
};

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
};

export type DiamondCompletenessEvidence = {
  status: DiamondCoverageStatus;
  authoritativeRevision: number;
  families: Record<string, DiamondCoverageStatus>;
  omissions: string[];
};

export type DiamondScorerLease = {
  status: 'owned' | 'held-by-other' | 'available' | 'expired';
  canScore: boolean;
  holderUid: string | null;
  holderName: string | null;
  expiresAt: string | null;
  eligibleScorers: DiamondPlayerRef[];
};

export type DiamondScorebookSnapshot = {
  schemaVersion: 2;
  teamId: string;
  gameId: string;
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
  battingLineup: DiamondLineupEntry[];
  defensiveLineup: DiamondLineupEntry[];
  availablePlayers: Record<DiamondSide, DiamondPlayerRef[]>;
  managedSide: DiamondSide | null;
  ruleCapabilities: DiamondRuleCapabilities;
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
  teamId: string;
  sport: DiamondSport;
  rulesProfileId: string;
  rulesProfileVersion: number;
};

export type DiamondGameActivation = {
  activated: boolean;
  teamId: string;
  gameId: string;
  trackingEngine: 'diamond-v2';
  snapshot: DiamondScorebookSnapshot | null;
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

export type DiamondQueuedCommand = {
  command: DiamondCommandEnvelope;
  queuedAt: string;
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
  'finalize'
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

const queueVersion = 1;
const queuePrefix = 'allplays:diamond-scorebook:queue:v1';
const maxQueueCommands = 2000;
const maxQueueBytes = 2_000_000;
const retryableCallableCodes = new Set(['deadline-exceeded', 'internal', 'network-request-failed', 'unavailable', 'unknown']);

function compactText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function requireResourceId(value: unknown, label: string) {
  const normalized = compactText(value);
  if (!normalized || normalized.length > 128 || normalized.includes('/')) {
    throw new DiamondScorebookError('invalid-input', `${label} is missing or invalid.`);
  }
  return normalized;
}

function requireRevision(value: unknown, label = 'Expected revision') {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new DiamondScorebookError('invalid-input', `${label} must be a nonnegative integer.`);
  }
  return revision;
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
  if (code === 'resource-exhausted') {
    return new DiamondScorebookError('rate-limited', 'Too many scorebook requests. Pause briefly, then retry.', {
      retryable: true,
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
      return callNativeFirebaseFunction<T>(name, data, { errorLabel: 'Diamond scorebook' });
    }
    const response = await httpsCallable(functions, name)(data);
    return response?.data as T;
  }
};

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
          battingRole: compactText(source.battingRole) || null
        }
      ];
    })
    .sort((a, b) => a.slot - b.slot)
    .slice(0, 25);
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
  const canScore = source.canScore === true || source.ownedByCaller === true;
  const rawStatus = compactText(source.status);
  const status: DiamondScorerLease['status'] =
    rawStatus === 'owned' || rawStatus === 'held-by-other' || rawStatus === 'expired'
      ? rawStatus
      : canScore
        ? 'owned'
        : holderUid
          ? 'held-by-other'
          : 'available';
  return {
    status,
    canScore,
    holderUid,
    holderName: compactText(source.holderName || source.scorerName) || null,
    expiresAt: compactText(source.expiresAt) || null,
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
  const inningSource = asRecord(state.inning);
  const countSource = asRecord(state.count || inningSource.count);
  const scoreSource = asRecord(state.score);
  const basesSource = asRecord(state.bases);
  const lineupSource = asRecord(state.lineups || presentation.lineups);
  const half: DiamondHalf = inningSource.half === 'bottom' ? 'bottom' : 'top';
  const lifecycleSource = compactText(state.lifecycle);
  const lifecycle: DiamondLifecycle = ['configured', 'ready', 'active', 'suspended', 'final', 'correction'].includes(lifecycleSource)
    ? (lifecycleSource as DiamondLifecycle)
    : 'configured';
  const captureMode: DiamondCaptureMode = state.captureMode === 'full' ? 'full' : 'quick';
  const battingSide = half === 'top' ? 'away' : 'home';
  const homeLineup = normalizeLineup(lineupSource.home);
  const awayLineup = normalizeLineup(lineupSource.away);
  const battingLineup = normalizeLineup(presentation.battingLineup || lineupSource[battingSide] || state.battingLineup);
  const defensiveLineup = normalizeLineup(presentation.defensiveLineup || lineupSource[battingSide === 'home' ? 'away' : 'home']);
  const playersById = new Map([...homeLineup, ...awayLineup].map((player) => [player.playerId, player]));
  const nextBatterSlot = normalizeBoundedInteger(asRecord(state.nextBatterSlot)[battingSide], 0, 98, 0);
  const derivedBatter = battingLineup.length ? battingLineup[nextBatterSlot % battingLineup.length] || null : null;
  const defensiveSide = battingSide === 'home' ? 'away' : 'home';
  const defensiveLineupSource = asRecord(lineupSource[defensiveSide]);
  const derivedPitcherId = compactText(asRecord(defensiveLineupSource.defense).P);
  const enrichedBases = asRecord(presentation.bases || basesSource);
  const lease = normalizeLease(root.lease || state.lease, state.currentScorerUid);
  const rulesProfileId = requireResourceId(state.rulesProfileId || root.rulesProfileId, 'Rules profile ID');
  const rulesProfileVersion = requirePositiveVersion(state.rulesProfileVersion || root.rulesProfileVersion);
  const candidatesSource = presentation.availablePlayers || presentation.rosterCandidates;
  const candidateSides = asRecord(candidatesSource);
  const flatCandidates = Array.isArray(candidatesSource) ? candidatesSource : [];
  const homeCandidates = flatCandidates.filter((candidate) => asRecord(candidate).side === 'home');
  const awayCandidates = flatCandidates.filter((candidate) => asRecord(candidate).side === 'away');
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
    inning: {
      number: normalizeBoundedInteger(inningSource.number, 1, 99, 1),
      half,
      outs: normalizeBoundedInteger(inningSource.outs, 0, 3, 0),
      balls: normalizeBoundedInteger(inningSource.balls ?? countSource.balls, 0, 4, 0),
      strikes: normalizeBoundedInteger(inningSource.strikes ?? countSource.strikes, 0, 3, 0),
      pitchesInPlateAppearance: normalizeBoundedInteger(inningSource.pitchesInPlateAppearance, 0, 999, 0)
    },
    bases: {
      first: normalizePlayer(enrichedBases.first || enrichedBases['1']),
      second: normalizePlayer(enrichedBases.second || enrichedBases['2']),
      third: normalizePlayer(enrichedBases.third || enrichedBases['3'])
    },
    currentBatter: normalizePlayer(presentation.currentBatter || state.currentBatter) || derivedBatter,
    currentPitcher:
      normalizePlayer(presentation.currentPitcher || state.currentPitcher) ||
      (derivedPitcherId ? playersById.get(derivedPitcherId) || normalizePlayer(derivedPitcherId) : null),
    lineups: { home: homeLineup, away: awayLineup },
    battingLineup,
    defensiveLineup,
    availablePlayers: {
      home: normalizePlayerList(candidateSides.home || presentation.homePlayers || homeCandidates, homeLineup),
      away: normalizePlayerList(candidateSides.away || presentation.awayPlayers || awayCandidates, awayLineup)
    },
    managedSide,
    ruleCapabilities,
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
  return {
    outcome: rawOutcome,
    revision,
    eventId: compactText(source.eventId) || null,
    snapshot,
    completeness: snapshot?.completeness || normalizeCompleteness(source.completeness, revision)
  };
}

export async function getDiamondState(
  teamId: string,
  gameId: string,
  options: { visibility?: 'private' | 'public'; transport?: DiamondCallableTransport } = {}
) {
  const payload = {
    teamId: requireResourceId(teamId, 'Team ID'),
    gameId: requireResourceId(gameId, 'Game ID'),
    visibility: options.visibility === 'public' ? 'public' : 'private'
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
  options: { gameId?: string; transport?: DiamondCallableTransport } = {}
): Promise<DiamondAccess> {
  const payload: Record<string, unknown> = { teamId: requireResourceId(teamId, 'Team ID') };
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
  options: { transport?: DiamondCallableTransport; crypto?: SecureCrypto | null } = {}
): Promise<DiamondTeamConfiguration> {
  if (sport !== 'baseball' && sport !== 'fastpitch') {
    throw new DiamondScorebookError('invalid-input', 'Diamond scorebook setup supports Baseball or Fastpitch.');
  }
  const selectedRulesProfileId = rulesProfileId || `${sport}-youth`;
  const payload = {
    requestId: createSecureDiamondId(options.crypto === undefined ? globalThis.crypto : options.crypto),
    teamId: requireResourceId(teamId, 'Team ID'),
    enabled: true,
    sport,
    rulesProfileId: requireResourceId(selectedRulesProfileId, 'Rules profile ID'),
    rulesProfileVersion: 1,
    captureMode: 'quick'
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
    return {
      configured: true,
      teamId: requireResourceId(source.teamId || payload.teamId, 'Team ID'),
      sport,
      rulesProfileId: requireResourceId(source.rulesProfileId, 'Rules profile ID'),
      rulesProfileVersion: requirePositiveVersion(source.rulesProfileVersion)
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
  },
  options: { transport?: DiamondCallableTransport; crypto?: SecureCrypto | null } = {}
): Promise<DiamondGameActivation> {
  const payload = {
    requestId: createSecureDiamondId(options.crypto === undefined ? globalThis.crypto : options.crypto),
    teamId: requireResourceId(input.teamId, 'Team ID'),
    gameId: requireResourceId(input.gameId, 'Game ID'),
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

export function getDiamondQueueKey(teamId: string, gameId: string) {
  return `${queuePrefix}:${encodeURIComponent(requireResourceId(teamId, 'Team ID'))}:${encodeURIComponent(requireResourceId(gameId, 'Game ID'))}`;
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
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveQueueFields(entry));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([entryKey, entry]) => containsSensitiveQueueFields(entry, entryKey));
  }
  return false;
}

export function readDiamondCommandQueue(
  teamId: string,
  gameId: string,
  storage: StorageLike | null = getDefaultStorage()
): DiamondQueuedCommand[] {
  if (!storage) return [];
  const key = getDiamondQueueKey(teamId, gameId);
  try {
    const parsed = JSON.parse(storage.getItem(key) || 'null');
    if (!parsed || parsed.version !== queueVersion || !Array.isArray(parsed.items)) return [];
    return parsed.items
      .flatMap((entry: unknown) => {
        const source = asRecord(entry);
        try {
          const command = normalizeCommand(source.command);
          if (
            command.teamId !== teamId ||
            command.gameId !== gameId ||
            command.type === 'private_note' ||
            containsSensitiveQueueFields(command.payload)
          )
            return [];
          return [{ command, queuedAt: compactText(source.queuedAt) || new Date(0).toISOString() }];
        } catch {
          return [];
        }
      })
      .slice(0, maxQueueCommands);
  } catch {
    return [];
  }
}

function writeDiamondCommandQueue(teamId: string, gameId: string, items: DiamondQueuedCommand[], storage: StorageLike | null) {
  if (!storage) {
    throw new DiamondScorebookError(
      'storage-unavailable',
      'This device cannot safely retain an offline scoring queue. Reconnect before scoring.'
    );
  }
  const key = getDiamondQueueKey(teamId, gameId);
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
  const serialized = JSON.stringify({ version: queueVersion, items });
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
  storage: StorageLike | null = getDefaultStorage(),
  now: () => Date = () => new Date()
) {
  const command = normalizeCommand(commandValue);
  if (command.type === 'private_note' || containsSensitiveQueueFields(command.payload)) {
    throw new DiamondScorebookError(
      'storage-unavailable',
      'Private notes and raw dictation are never stored in the offline scoring queue. Reconnect to save this note.'
    );
  }
  const items = readDiamondCommandQueue(command.teamId, command.gameId, storage);
  const existing = items.find((entry) => entry.command.commandId === command.commandId);
  if (existing) {
    if (JSON.stringify(existing.command) !== JSON.stringify(command)) {
      throw new DiamondScorebookError('conflict', 'This command ID is already queued with different play details.');
    }
    return items;
  }
  const next = [...items, { command, queuedAt: now().toISOString() }];
  writeDiamondCommandQueue(command.teamId, command.gameId, next, storage);
  return next;
}

export async function reconcileDiamondCommandQueue(
  teamId: string,
  gameId: string,
  options: { storage?: StorageLike | null; transport?: DiamondCallableTransport } = {}
): Promise<DiamondQueueReconciliation> {
  const storage = options.storage === undefined ? getDefaultStorage() : options.storage;
  let remaining = readDiamondCommandQueue(teamId, gameId, storage);
  let accepted = 0;
  let duplicates = 0;
  let lastSnapshot: DiamondScorebookSnapshot | null = null;
  while (remaining.length > 0) {
    const current = remaining[0]!;
    const result = await submitDiamondCommand(current.command, { transport: options.transport });
    if (result.outcome === 'duplicate') duplicates += 1;
    else accepted += 1;
    lastSnapshot = result.snapshot || lastSnapshot;
    remaining = remaining.slice(1);
    writeDiamondCommandQueue(teamId, gameId, remaining, storage);
  }
  return { accepted, duplicates, remaining, lastSnapshot };
}

export type DiamondScorebookClient = {
  load: typeof getDiamondState;
  createSecureId: typeof createSecureDiamondId;
  createCommand: typeof createDiamondCommand;
  submitCommand: typeof submitDiamondCommand;
  parseVoice: typeof parseDiamondVoice;
  savePrivateNote: typeof saveDiamondPrivateNote;
  requestHandoff: typeof requestDiamondScorerHandoff;
  readQueue: typeof readDiamondCommandQueue;
  enqueue: typeof enqueueDiamondCommand;
  reconcileQueue: typeof reconcileDiamondCommandQueue;
};

export const diamondScorebookClient: DiamondScorebookClient = {
  load: getDiamondState,
  createSecureId: createSecureDiamondId,
  createCommand: createDiamondCommand,
  submitCommand: submitDiamondCommand,
  parseVoice: parseDiamondVoice,
  savePrivateNote: saveDiamondPrivateNote,
  requestHandoff: requestDiamondScorerHandoff,
  readQueue: readDiamondCommandQueue,
  enqueue: enqueueDiamondCommand,
  reconcileQueue: reconcileDiamondCommandQueue
};
