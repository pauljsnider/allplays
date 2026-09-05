export const DIAMOND_SCHEMA_VERSION = 2 as const;
export const DIAMOND_REDUCER_VERSION = 1 as const;
export const DIAMOND_STAT_CATALOG_VERSION = 1 as const;

export type DiamondSport = 'baseball' | 'fastpitch';
export type DiamondSide = 'home' | 'away';
export type DiamondHalf = 'top' | 'bottom';
export type DiamondBase = 'first' | 'second' | 'third';
export type DiamondDestination = DiamondBase | 'home' | 'out' | 'stay';
export type DiamondCaptureMode = 'quick' | 'full';
export type DiamondLifecycle = 'configured' | 'ready' | 'active' | 'suspended' | 'final' | 'correction';

export type DiamondCoverage = 'complete' | 'partial' | 'not_collected';
export type DiamondStatFamily = 'batting' | 'baserunning' | 'pitching' | 'fielding' | 'situational' | 'pitches' | 'sensors';

export type DiamondCoverageMap = Readonly<Record<DiamondStatFamily, DiamondCoverage>>;

export type DiamondDefensivePosition =
  'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'LCF' | 'CF' | 'RCF' | 'RF' | 'DP' | 'FLEX' | 'EH' | 'EP';

export type DiamondBattingRole = 'regular' | 'dp' | 'flex' | 'eh' | 'ep';

export type DiamondLineupEntryInput = Readonly<{
  slot: number;
  playerId: string;
  displayName?: string;
  jerseyNumber?: string;
  starter?: boolean;
  battingRole?: DiamondBattingRole;
}>;

export type DiamondLineupSlot = Readonly<{
  slot: number;
  activePlayerId: string;
  starterPlayerId: string;
  displayName?: string;
  jerseyNumber?: string;
  battingRole: DiamondBattingRole;
  starterReentriesUsed: number;
  substitutions: readonly string[];
}>;

export type DiamondTeamLineup = Readonly<{
  battingOrder: readonly DiamondLineupSlot[];
  defense: Readonly<Partial<Record<DiamondDefensivePosition, string>>>;
  dpFlex: Readonly<{
    dpPlayerId: string;
    flexPlayerId: string;
    dpBattingSlot: number;
    flexDefensivePosition: DiamondDefensivePosition;
  }> | null;
}>;

export type DiamondRunnerPlacement = Readonly<{
  runnerId: string;
  chargedToPitcherId: string | null;
  courtesyForPlayerId: string | null;
  reachedOnEventId: string | null;
}>;

export type DiamondBases = Readonly<Record<DiamondBase, DiamondRunnerPlacement | null>>;

export type DiamondScore = Readonly<Record<DiamondSide, number>>;

export type DiamondInningState = Readonly<{
  number: number;
  half: DiamondHalf;
  outs: number;
  balls: number;
  strikes: number;
  pitchesInPlateAppearance: number;
}>;

export type DiamondGameState = Readonly<{
  schemaVersion: typeof DIAMOND_SCHEMA_VERSION;
  reducerVersion: typeof DIAMOND_REDUCER_VERSION;
  statCatalogVersion: typeof DIAMOND_STAT_CATALOG_VERSION;
  teamId: string;
  gameId: string;
  rulesProfileId: string;
  rulesProfileVersion: number;
  captureMode: DiamondCaptureMode;
  lifecycle: DiamondLifecycle;
  revision: number;
  currentScorerUid: string | null;
  inning: DiamondInningState;
  score: DiamondScore;
  inningRuns: Readonly<Record<string, number>>;
  bases: DiamondBases;
  lineups: Readonly<Record<DiamondSide, DiamondTeamLineup>>;
  nextBatterSlot: Readonly<Record<DiamondSide, number>>;
  coverage: DiamondCoverageMap;
  suspendedReason: string | null;
  finalConfirmedAtRevision: number | null;
  checkpointHash: string;
}>;

export type DiamondPitchResult =
  | 'ball'
  | 'called_strike'
  | 'swinging_strike'
  | 'foul'
  | 'foul_bunt'
  | 'in_play'
  | 'hit_by_pitch'
  | 'catcher_interference'
  | 'illegal_pitch'
  | 'balk'
  | 'pickoff_attempt';

export type DiamondPlateAppearanceResult =
  | 'single'
  | 'double'
  | 'triple'
  | 'home_run'
  | 'walk'
  | 'intentional_walk'
  | 'hit_by_pitch'
  | 'strikeout'
  | 'reached_on_error'
  | 'fielders_choice'
  | 'sacrifice_bunt'
  | 'sacrifice_fly'
  | 'interference'
  | 'dropped_third_strike'
  | 'ground_out'
  | 'fly_out'
  | 'line_out'
  | 'double_play'
  | 'triple_play';

export type DiamondRunnerAdvanceCause =
  | 'batted_ball'
  | 'walk'
  | 'hit_by_pitch'
  | 'stolen_base'
  | 'caught_stealing'
  | 'pickoff'
  | 'wild_pitch'
  | 'passed_ball'
  | 'balk'
  | 'illegal_pitch'
  | 'defensive_indifference'
  | 'error'
  | 'obstruction'
  | 'force_out'
  | 'tag_out'
  | 'appeal_out'
  | 'courtesy_runner'
  | 'tiebreaker'
  | 'other';

export type DiamondOutKind = 'force' | 'tag' | 'appeal' | 'batter_runner' | 'strikeout' | 'catch';

export type DiamondScoringCredit = Readonly<{
  countsRun?: boolean;
  earned?: boolean;
  rbi?: boolean;
  responsiblePitcherId?: string;
}>;

export type DiamondBatterAdvance = DiamondScoringCredit &
  Readonly<{
    to: DiamondDestination;
    cause?: DiamondRunnerAdvanceCause;
    outKind?: DiamondOutKind;
  }>;

export type DiamondRunnerAdvance = DiamondScoringCredit &
  Readonly<{
    runnerId: string;
    from: DiamondBase;
    to: DiamondDestination;
    cause: DiamondRunnerAdvanceCause;
    outKind?: DiamondOutKind;
  }>;

export type DiamondFieldingChain = Readonly<{
  putoutBy?: string;
  assists?: readonly string[];
  errors?: readonly Readonly<{ playerId: string; kind?: 'fielding' | 'throwing' }>[];
  passedBallBy?: string;
  doublePlay?: boolean;
  triplePlay?: boolean;
  battedBall?: 'ground' | 'line' | 'fly' | 'bunt' | 'unknown';
  location?: string;
}>;

export type DiamondCommandPayloadMap = {
  activate: Readonly<{ initialScorerUid: string; captureMode: DiamondCaptureMode }>;
  set_lineup: Readonly<{ side: DiamondSide; entries: readonly DiamondLineupEntryInput[] }>;
  set_defensive_alignment: Readonly<{
    side: DiamondSide;
    assignments: readonly Readonly<{ playerId: string; position: DiamondDefensivePosition }>[];
  }>;
  set_dp_flex: Readonly<{
    side: DiamondSide;
    dpPlayerId: string;
    flexPlayerId: string;
    dpBattingSlot: number;
    flexDefensivePosition: DiamondDefensivePosition;
  }>;
  start: Readonly<Record<string, never>>;
  record_pitch: Readonly<{
    pitcherId: string;
    batterId: string;
    result: DiamondPitchResult;
  }>;
  record_plate_appearance: Readonly<{
    batterId: string;
    pitcherId: string;
    result: DiamondPlateAppearanceResult;
    batterAdvance: DiamondBatterAdvance;
    runnerAdvances: readonly DiamondRunnerAdvance[];
    outsOnPlay: number;
    runsBattedIn?: number;
    fielding?: DiamondFieldingChain;
    omissions?: readonly DiamondStatFamily[];
  }>;
  advance_runner: DiamondScoringCredit &
    Readonly<{
      runnerId: string;
      from: DiamondBase;
      to: DiamondDestination;
      cause: DiamondRunnerAdvanceCause;
      outKind?: DiamondOutKind;
      fielding?: DiamondFieldingChain;
      omissions?: readonly DiamondStatFamily[];
    }>;
  record_fielding: Readonly<{
    playEventId: string;
    fielding: DiamondFieldingChain;
  }>;
  record_scoring_judgment: Readonly<{
    playEventId: string;
    runnerId?: string;
    earned?: boolean;
    rbi?: boolean;
    responsiblePitcherId?: string;
    pitcherOfRecord?: Readonly<{ side: DiamondSide; playerId: string; decision: 'win' | 'loss' | 'save' }>;
  }>;
  advance_half_inning: Readonly<Record<string, never>>;
  place_tiebreaker_runner: Readonly<{
    side: DiamondSide;
    runnerId: string;
    base: DiamondBase;
    chargedToPitcherId?: string;
  }>;
  substitute: Readonly<{
    side: DiamondSide;
    battingSlot: number;
    outgoingPlayerId: string;
    incomingPlayerId: string;
    defensivePosition?: DiamondDefensivePosition;
  }>;
  re_enter: Readonly<{
    side: DiamondSide;
    battingSlot: number;
    starterPlayerId: string;
    replacedPlayerId: string;
    defensivePosition?: DiamondDefensivePosition;
  }>;
  add_courtesy_runner: Readonly<{
    side: DiamondSide;
    forPlayerId: string;
    runnerId: string;
    base: DiamondBase;
    forRole: 'pitcher' | 'catcher';
  }>;
  scorer_handoff: Readonly<{ toUid: string }>;
  suspend: Readonly<{ reason: string }>;
  resume: Readonly<Record<string, never>>;
  finalize: Readonly<{ confirmed: true }>;
  reopen_for_correction: Readonly<{ reason: string }>;
  private_note: Readonly<{ text: string; attachedEventId?: string; visibility?: 'staff-private' }>;
  rules_decision: Readonly<{
    code: string;
    description: string;
    affectedFamilies?: readonly DiamondStatFamily[];
  }>;
  void_event: Readonly<{ targetEventId: string; reason: string }>;
  supersede_event: Readonly<{
    targetEventId: string;
    reason: string;
    replacement: DiamondReplacement;
  }>;
};

export type DiamondCommandType = keyof DiamondCommandPayloadMap;

export type DiamondCorrectableCommandType = Exclude<
  DiamondCommandType,
  'activate' | 'start' | 'scorer_handoff' | 'suspend' | 'resume' | 'finalize' | 'reopen_for_correction' | 'void_event' | 'supersede_event'
>;

export type DiamondReplacement = {
  [K in DiamondCorrectableCommandType]: Readonly<{
    type: K;
    payload: DiamondCommandPayloadMap[K];
  }>;
}[DiamondCorrectableCommandType];

export type DiamondCommandEnvelope<TType extends DiamondCommandType = DiamondCommandType> = Readonly<{
  schemaVersion: typeof DIAMOND_SCHEMA_VERSION;
  commandId: string;
  teamId: string;
  gameId: string;
  expectedRevision: number;
  rulesProfileId: string;
  rulesProfileVersion: number;
  type: TType;
  payload: DiamondCommandPayloadMap[TType];
}>;

export type DiamondCommand = {
  [K in DiamondCommandType]: DiamondCommandEnvelope<K>;
}[DiamondCommandType];

export type DiamondEventEnvelope<TType extends DiamondCommandType = DiamondCommandType> = Readonly<{
  schemaVersion: typeof DIAMOND_SCHEMA_VERSION;
  eventId: string;
  sequence: number;
  revision: number;
  commandId: string;
  commandHash: string;
  type: TType;
  payload: DiamondCommandPayloadMap[TType];
  actorUid: string;
  serverTimestampMs: number;
  rulesProfileId: string;
  rulesProfileVersion: number;
  reducerVersion: typeof DIAMOND_REDUCER_VERSION;
  statCatalogVersion: typeof DIAMOND_STAT_CATALOG_VERSION;
  supersedesEventId?: string;
  voidsEventId?: string;
  before: DiamondGameState;
  after: DiamondGameState;
  previousHash: string;
  hash: string;
}>;

export type DiamondEvent = {
  [K in DiamondCommandType]: DiamondEventEnvelope<K>;
}[DiamondCommandType];

export type DiamondEffectiveEvent = Readonly<{
  eventId: string;
  sourceEventId: string;
  revision: number;
  type: DiamondCorrectableCommandType | Exclude<DiamondCommandType, 'void_event' | 'supersede_event'>;
  payload: DiamondCommandPayloadMap[DiamondCommandType];
  correctionEventId?: string;
}>;

export type DiamondCommandRejection = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;

export type DiamondCommandResult = Readonly<{
  outcome: 'accepted' | 'duplicate' | 'rejected';
  revision: number;
  eventId?: string;
  state: DiamondGameState;
  rejection?: DiamondCommandRejection;
}>;

export type DiamondLedger = Readonly<{
  teamId: string;
  gameId: string;
  rulesProfileId: string;
  rulesProfileVersion: number;
  captureMode: DiamondCaptureMode;
  initialState: DiamondGameState;
  state: DiamondGameState;
  events: readonly DiamondEvent[];
}>;

export type DiamondCommandContext = Readonly<{
  actorUid: string;
  eventId: string;
  serverTimestampMs: number;
}>;

export type DiamondRulesProfile = Readonly<{
  id: string;
  version: number;
  name: string;
  sport: DiamondSport;
  scheduledInnings: number;
  eraInningsBasis: number;
  timeLimitMinutes: number | null;
  inningRunLimit: number | null;
  runAheadRules: readonly Readonly<{ afterInning: number; runDifferential: number }>[];
  tiebreaker: Readonly<{ enabled: boolean; startInning: number; runnerBase: DiamondBase }>;
  continuousBatting: boolean;
  freeSubstitution: boolean;
  starterReentryLimit: number;
  allowsDh: boolean;
  allowsEh: boolean;
  allowsEp: boolean;
  dpFlex: Readonly<{ enabled: boolean; flexMayBatForDpOnly: boolean }>;
  courtesyRunner: Readonly<{ pitcher: boolean; catcher: boolean }>;
  droppedThirdStrike: Readonly<{
    enabled: boolean;
    disallowWhenFirstOccupiedWithFewerThanTwoOuts: boolean;
  }>;
  illegalPitchPolicy: 'ball' | 'ball_and_advance' | 'configurable';
  lookBackRule: boolean;
  leavingEarlyRule: 'appeal' | 'immediate_out' | 'none';
}>;

export type DiamondLedgerConfig = Readonly<{
  teamId: string;
  gameId: string;
  rulesProfileId: string;
  rulesProfileVersion: number;
  captureMode: DiamondCaptureMode;
}>;

export type DiamondExecution = Readonly<{
  ledger: DiamondLedger;
  result: DiamondCommandResult;
  event?: DiamondEvent;
}>;

export type DiamondCommandReceipt = Readonly<{
  commandId: string;
  commandHash: string;
  event: DiamondEvent;
  result: DiamondCommandResult;
}>;

/**
 * Bounded authoritative input for the common command path. The server reads this
 * checkpoint and only the submitted command's receipt in one transaction; it
 * does not load the historical event collection.
 */
export type DiamondCheckpoint = Readonly<{
  teamId: string;
  gameId: string;
  rulesProfileId: string;
  rulesProfileVersion: number;
  captureMode: DiamondCaptureMode;
  sequence: number;
  previousHash: string;
  state: DiamondGameState;
}>;

export type DiamondCheckpointExecution = Readonly<{
  checkpoint: DiamondCheckpoint;
  result: DiamondCommandResult;
  event?: DiamondEvent;
  receipt?: DiamondCommandReceipt;
}>;

export class DiamondDomainError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'DiamondDomainError';
    this.code = code;
    this.retryable = retryable;
  }
}
