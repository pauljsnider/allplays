import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  CircleDot,
  CloudOff,
  Loader2,
  LockKeyhole,
  Mic,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRoundCheck,
  Wifi
} from 'lucide-react';
import { Modal } from '../components/Modal';
import {
  appendDictationTranscript,
  collectFinalDictationTranscript,
  getDictationErrorMessage,
  getSpeechRecognitionConstructor,
  isCapacitorNativeRuntime,
  startNativeSpeechDictation,
  type SpeechRecognitionLike
} from '../lib/dictation';
import {
  draftDiamondGameSummary,
  interpretDiamondTranscript,
  type DiamondAiCommandContext,
  type DiamondAiDependencies,
  type DiamondAiGameDraft
} from '../lib/diamondScorebookAi';
import {
  diamondOutNecessarilyCancelsRun,
  diamondRequiredBatterAdvanceOutKind,
  diamondRequiredBatterOutKind,
  getDiamondRulesProfile,
  isDiamondTerminalPitchResult,
  type DiamondBattingRole,
  type DiamondDefensivePosition,
  type DiamondOutKind,
  type DiamondPlateAppearanceResult,
  type DiamondRunnerAdvanceCause,
  type DiamondRuleDecisionCode,
  type DiamondRulesProfile
} from '../lib/diamondScorebook';
import {
  DiamondScorebookError,
  diamondScorebookClient,
  mergeDiamondPrivateHistoryWindows,
  type DiamondAiPublicationEvidence,
  type DiamondCaptureMode,
  type DiamondCommandEnvelope,
  type DiamondCommandOutcome,
  type DiamondCommandType,
  type DiamondJsonObject,
  type DiamondLineupEntry,
  type DiamondPlayerRef,
  type DiamondPrivateEvent,
  type DiamondPrivateHistoryWindow,
  type DiamondQueueIdentity,
  type DiamondRecapSource,
  type DiamondScorebookClient,
  type DiamondScorebookSnapshot,
  type DiamondScorerCandidateList,
  type DiamondSide,
  type DiamondVoiceProposal
} from '../lib/diamondScorebookService';
import type { AuthState } from '../lib/types';

type DiamondScorebookProps = {
  auth: AuthState;
  teamId?: string;
  gameId?: string;
  initialSnapshot?: DiamondScorebookSnapshot | null;
  client?: DiamondScorebookClient;
  aiDependencies?: DiamondAiDependencies;
};

type Notice = {
  tone: 'info' | 'success' | 'error';
  message: string;
};

type DiamondBase = 'first' | 'second' | 'third';
type RunnerDestination = 'stay' | 'first' | 'second' | 'third' | 'home' | 'out';
type RunnerMoveDraft = {
  key: string;
  label: string;
  playerId: string;
  from: 'batter' | 'first' | 'second' | 'third';
  to: RunnerDestination;
  cause: DiamondRunnerAdvanceCause;
  outKind?: DiamondOutKind;
  countsRun?: boolean;
  rbi?: boolean;
  responsiblePitcherId?: string;
  earned?: boolean;
};

type LineupDrafts = Record<DiamondSide, DiamondLineupEntry[]>;
type DefenseDrafts = Record<DiamondSide, Partial<Record<DiamondDefensivePosition, string>>>;
type ActiveDefenseDraft = {
  assignments: Partial<Record<DiamondDefensivePosition, string>>;
  sourceRevision: number;
  sourceInstanceId: string;
  sourceLeaseId: string;
  sourceDefenseFingerprint: string;
  sourcePersonnelFingerprint: string;
};
type ActiveDefenseDrafts = Record<DiamondSide, ActiveDefenseDraft | null>;
type ActiveDefenseReviewSource = {
  side: DiamondSide;
  sourceRevision: number;
  sourceInstanceId: string;
  sourceLeaseId: string;
  authenticatedUid: string;
  sourceDefenseFingerprint: string;
  sourcePersonnelFingerprint: string;
};
type PlateAppearanceReviewSource = {
  sourceRevision: number;
  sourceInstanceId: string;
  sourceLeaseId: string;
  authenticatedUid: string;
  batterId: string;
  pitcherId: string;
  sourceBaseFingerprint: string;
};
type RunnerAdvanceReviewSource = {
  sourceRevision: number;
  sourceInstanceId: string;
  sourceLeaseId: string;
  authenticatedUid: string;
  sourceBaseFingerprint: string;
};
type SubstitutionCommandType = 'substitute' | 're_enter';
type SubstitutionReviewSource = {
  commandType: SubstitutionCommandType;
  side: DiamondSide;
  battingSlot: number;
  outgoingPlayerId: string;
  incomingPlayerId: string;
  sourceRevision: number;
  sourceInstanceId: string;
  sourceLeaseId: string;
  authenticatedUid: string;
  outgoingDefensivePosition: DiamondDefensivePosition | null;
  sourceDefensiveAssignmentCount: number;
  sourceDefenseFingerprint: string;
  sourceBaseFingerprint: string | null;
  transferBase: DiamondBase | null;
};

type PendingPlay = {
  source: 'tap' | 'voice';
  label: string;
  type: DiamondCommandType;
  payload: DiamondJsonObject;
  payloadDraft: string;
  result: string;
  runnerMoves: RunnerMoveDraft[];
  outsOnPlay: number;
  runsBattedIn: number;
  putoutBy: string;
  assistBy: string;
  errorBy: string;
  battedBall: string;
  unresolvedFields: string[];
  ambiguityConfirmed: boolean;
  aiConfidence: number | null;
  sourceRevision: number | null;
  batterId?: string;
  pitcherId?: string;
  correction?: { targetEventId: string; reason: string };
  activeDefenseSource?: ActiveDefenseReviewSource;
  plateAppearanceSource?: PlateAppearanceReviewSource;
  runnerAdvanceSource?: RunnerAdvanceReviewSource;
  substitutionSource?: SubstitutionReviewSource;
};

type PendingVoiceProposal = {
  sourceRevision: number;
  type: DiamondCommandType;
  payload: DiamondJsonObject;
  confidence: number;
  unresolvedQuestions: string[];
};

type Confirmation =
  | { kind: 'void'; eventId: string; label: string; reason: string }
  | { kind: 'finalize' }
  | {
      kind: 'rules-decision';
      code: SupportedRulesDecisionCode;
      label: string;
      description: string;
      opensFinalization: boolean;
    }
  | { kind: 'reopen'; reason: string }
  | { kind: 'handoff'; toUid: string; toName: string };

type SupportedRulesDecisionCode = Exclude<DiamondRuleDecisionCode, 'coverage_adjustment'>;
type CommandSubmissionResult = 'accepted' | 'queued' | 'reconciling' | false;

type DiamondAiDraftState = {
  source: DiamondRecapSource;
  draft: DiamondAiGameDraft;
  stale: boolean;
  publication: DiamondAiPublicationEvidence | null;
};

type DiamondHandoffCandidateState = {
  authenticatedUid: string;
  result: DiamondScorerCandidateList;
};

type OutcomeOption = {
  result: string;
  label: string;
  batterTo: RunnerDestination;
  outs: number;
  fullOnly?: boolean;
};

type DiamondEffectivePrivateEvent = DiamondPrivateEvent & {
  sourceEventId: string;
  effectiveType: DiamondCommandType;
  effectivePayload: DiamondJsonObject;
  corrected: boolean;
};

const uncorrectableEventTypes = new Set<DiamondCommandType>([
  'activate',
  'start',
  'scorer_handoff',
  'suspend',
  'resume',
  'cancel',
  'finalize',
  'reopen_for_correction',
  'void_event',
  'supersede_event'
]);

function effectivePrivateEvents(events: DiamondPrivateEvent[]): DiamondEffectivePrivateEvent[] {
  const directives = new Map<string, DiamondPrivateEvent>();
  events.forEach((event) => {
    if ((event.type === 'void_event' || event.type === 'supersede_event') && (event.voidsEventId || event.supersedesEventId)) {
      directives.set(event.voidsEventId || event.supersedesEventId || '', event);
    }
  });
  return events.flatMap<DiamondEffectivePrivateEvent>((event) => {
    if (event.type === 'void_event' || event.type === 'supersede_event') return [];
    const correction = directives.get(event.eventId);
    if (correction?.type === 'void_event') return [];
    if (correction?.type === 'supersede_event') {
      const replacement = correction.payload.replacement;
      if (!replacement || Array.isArray(replacement) || typeof replacement !== 'object') return [];
      const replacementRecord = replacement as DiamondJsonObject;
      const effectiveType = readString(replacementRecord.type) as DiamondCommandType;
      const effectivePayload = replacementRecord.payload;
      if (!effectiveType || !effectivePayload || Array.isArray(effectivePayload) || typeof effectivePayload !== 'object') return [];
      return [
        { ...event, sourceEventId: event.eventId, effectiveType, effectivePayload: effectivePayload as DiamondJsonObject, corrected: true }
      ];
    }
    return [{ ...event, sourceEventId: event.eventId, effectiveType: event.type, effectivePayload: event.payload, corrected: false }];
  });
}

function privateEventLabel(event: Pick<DiamondEffectivePrivateEvent, 'effectiveType' | 'effectivePayload' | 'revision'>) {
  const result = readString(event.effectivePayload.result);
  if (event.effectiveType === 'private_note') return `Private note · revision ${event.revision}`;
  if (event.effectiveType === 'record_plate_appearance' && result) return `${result.replace(/_/g, ' ')} · revision ${event.revision}`;
  if (event.effectiveType === 'advance_runner') {
    return `${readString(event.effectivePayload.cause).replace(/_/g, ' ') || 'Runner play'} · revision ${event.revision}`;
  }
  return `${event.effectiveType.replace(/_/g, ' ')} · revision ${event.revision}`;
}

const outcomeOptions: OutcomeOption[] = [
  { result: 'single', label: 'Single', batterTo: 'first', outs: 0 },
  { result: 'double', label: 'Double', batterTo: 'second', outs: 0 },
  { result: 'triple', label: 'Triple', batterTo: 'third', outs: 0 },
  { result: 'home_run', label: 'Home run', batterTo: 'home', outs: 0 },
  { result: 'walk', label: 'Walk', batterTo: 'first', outs: 0 },
  { result: 'intentional_walk', label: 'Intentional walk', batterTo: 'first', outs: 0 },
  { result: 'hit_by_pitch', label: 'Hit by pitch', batterTo: 'first', outs: 0 },
  { result: 'strikeout', label: 'Strikeout', batterTo: 'out', outs: 1 },
  { result: 'ground_out', label: 'Ground out', batterTo: 'out', outs: 1 },
  { result: 'fly_out', label: 'Fly out', batterTo: 'out', outs: 1 },
  { result: 'line_out', label: 'Line out', batterTo: 'out', outs: 1, fullOnly: true },
  { result: 'reached_on_error', label: 'Reached on error', batterTo: 'first', outs: 0, fullOnly: true },
  { result: 'fielders_choice', label: "Fielder's choice", batterTo: 'first', outs: 1, fullOnly: true },
  { result: 'sacrifice_bunt', label: 'Sac bunt', batterTo: 'out', outs: 1, fullOnly: true },
  { result: 'sacrifice_fly', label: 'Sac fly', batterTo: 'out', outs: 1, fullOnly: true },
  { result: 'interference', label: 'Interference', batterTo: 'first', outs: 0, fullOnly: true },
  { result: 'dropped_third_strike', label: 'Dropped third strike', batterTo: 'first', outs: 0, fullOnly: true },
  { result: 'double_play', label: 'Double play', batterTo: 'out', outs: 2, fullOnly: true },
  { result: 'triple_play', label: 'Triple play', batterTo: 'out', outs: 3, fullOnly: true }
];

function isSacrificeResult(result: string) {
  return result === 'sacrifice_bunt' || result === 'sacrifice_fly';
}

const pitchOptions = [
  { result: 'ball', label: 'Ball' },
  { result: 'called_strike', label: 'Called strike' },
  { result: 'swinging_strike', label: 'Swinging strike' },
  { result: 'foul', label: 'Foul' },
  { result: 'foul_bunt', label: 'Foul bunt' },
  { result: 'in_play', label: 'In play' },
  { result: 'hit_by_pitch', label: 'Hit batter' },
  { result: 'catcher_interference', label: 'Catcher interference' },
  { result: 'illegal_pitch', label: 'Illegal pitch' },
  { result: 'balk', label: 'Balk' },
  { result: 'pickoff_attempt', label: 'Pickoff attempt' }
] as const;

function plateAppearanceRequiresResolution(snapshot: DiamondScorebookSnapshot) {
  return snapshot.inning.balls >= 4 || snapshot.inning.strikes >= 3 || isDiamondTerminalPitchResult(snapshot.lastPitchResult);
}

const destinationOptions: Array<{ value: RunnerDestination; label: string }> = [
  { value: 'stay', label: 'Hold' },
  { value: 'first', label: '1st' },
  { value: 'second', label: '2nd' },
  { value: 'third', label: '3rd' },
  { value: 'home', label: 'Home' },
  { value: 'out', label: 'Out' }
];

const runnerCauseOptions: Array<{ value: DiamondRunnerAdvanceCause; label: string }> = [
  { value: 'batted_ball', label: 'Batted ball' },
  { value: 'walk', label: 'Walk' },
  { value: 'hit_by_pitch', label: 'Hit by pitch' },
  { value: 'stolen_base', label: 'Stolen base' },
  { value: 'caught_stealing', label: 'Caught stealing' },
  { value: 'pickoff', label: 'Pickoff' },
  { value: 'wild_pitch', label: 'Wild pitch' },
  { value: 'passed_ball', label: 'Passed ball' },
  { value: 'balk', label: 'Balk' },
  { value: 'illegal_pitch', label: 'Illegal pitch' },
  { value: 'defensive_indifference', label: 'Defensive indifference' },
  { value: 'error', label: 'Error' },
  { value: 'obstruction', label: 'Obstruction' },
  { value: 'force_out', label: 'Force out' },
  { value: 'tag_out', label: 'Tag out' },
  { value: 'appeal_out', label: 'Appeal out' },
  { value: 'courtesy_runner', label: 'Courtesy runner' },
  { value: 'tiebreaker', label: 'Tiebreaker' },
  { value: 'other', label: 'Other' }
];
const outOnlyRunnerCauses = new Set<DiamondRunnerAdvanceCause>(['caught_stealing', 'pickoff', 'force_out', 'tag_out', 'appeal_out']);
const requiredRunnerOutKinds = new Map<DiamondRunnerAdvanceCause, DiamondOutKind>([
  ['caught_stealing', 'tag'],
  ['pickoff', 'tag'],
  ['force_out', 'force'],
  ['tag_out', 'tag'],
  ['appeal_out', 'appeal']
]);

const outKindOptions: Array<{ value: DiamondOutKind; label: string }> = [
  { value: 'force', label: 'Force' },
  { value: 'tag', label: 'Tag' },
  { value: 'appeal', label: 'Appeal' },
  { value: 'batter_runner', label: 'Batter-runner before first' },
  { value: 'strikeout', label: 'Strikeout' },
  { value: 'catch', label: 'Catch' }
];

const defensivePositions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'CF', 'RCF', 'RF'] as const;
const maximumDefensiveAssignments = 10;
const diamondBases: DiamondBase[] = ['first', 'second', 'third'];
const diamondCoverageFamilies = ['batting', 'baserunning', 'pitching', 'fielding', 'situational', 'pitches', 'sensors'] as const;
const minimumVoiceProposalConfidence = 0.75;

const battingRoleLabels: Readonly<Record<DiamondBattingRole, string>> = {
  regular: 'Regular',
  dh: 'DH',
  dp: 'DP',
  flex: 'FLEX',
  eh: 'EH',
  ep: 'EP'
};

function resolvePinnedRulesProfile(snapshot: DiamondScorebookSnapshot | null): DiamondRulesProfile | null {
  if (!snapshot) return null;
  const suffix = `@${snapshot.rulesProfileVersion}`;
  const profileId = snapshot.rulesProfileId.endsWith(suffix) ? snapshot.rulesProfileId.slice(0, -suffix.length) : snapshot.rulesProfileId;
  return getDiamondRulesProfile(profileId, snapshot.rulesProfileVersion);
}

function initialLineupBattingRoles(profile: DiamondRulesProfile | null, dpFlexAvailable: boolean): DiamondBattingRole[] {
  if (!profile) return ['regular'];
  const roles: DiamondBattingRole[] = ['regular'];
  if (profile.allowsDh) roles.push('dh');
  if (profile.dpFlex.enabled && dpFlexAvailable) roles.push('dp');
  if (profile.allowsEh) roles.push('eh');
  if (profile.allowsEp) roles.push('ep');
  // FLEX never occupies an initial batting slot. It is linked separately by set_dp_flex.
  return roles;
}

function normalizeInitialBattingRole(value: string | null | undefined, supported: readonly DiamondBattingRole[]): DiamondBattingRole {
  return supported.includes(value as DiamondBattingRole) ? (value as DiamondBattingRole) : 'regular';
}

function getQueueIdentity(
  snapshot: DiamondScorebookSnapshot | null,
  authenticatedUid: string | null | undefined
): DiamondQueueIdentity | null {
  if (
    !snapshot ||
    !authenticatedUid ||
    !snapshot.lease.canScore ||
    !snapshot.lease.holderUid ||
    !snapshot.lease.leaseId ||
    snapshot.lease.holderUid !== authenticatedUid
  ) {
    return null;
  }
  return {
    teamId: snapshot.teamId,
    gameId: snapshot.gameId,
    authenticatedUid,
    scorerUid: snapshot.lease.holderUid,
    instanceId: snapshot.instanceId,
    leaseId: snapshot.lease.leaseId
  };
}

function plateAppearanceBaseFingerprint(snapshot: DiamondScorebookSnapshot) {
  return JSON.stringify(
    diamondBases.map((base) => {
      const runner = snapshot.bases[base];
      return {
        base,
        runnerId: runner?.playerId || null,
        responsiblePitcherId: runner?.responsiblePitcherId || null,
        courtesyForPlayerId: runner?.courtesyForPlayerId || null,
        reachedOnEventId: runner?.reachedOnEventId || null
      };
    })
  );
}

function buildPlateAppearanceReviewSource(
  snapshot: DiamondScorebookSnapshot,
  authenticatedUid: string | null | undefined
): PlateAppearanceReviewSource | null {
  if (!snapshot.authoritative || snapshot.lifecycle !== 'active' || !snapshot.currentBatter || !snapshot.currentPitcher) return null;
  const identity = getQueueIdentity(snapshot, authenticatedUid);
  if (!identity) return null;
  return {
    sourceRevision: snapshot.revision,
    sourceInstanceId: snapshot.instanceId,
    sourceLeaseId: identity.leaseId,
    authenticatedUid: identity.authenticatedUid,
    batterId: snapshot.currentBatter.playerId,
    pitcherId: snapshot.currentPitcher.playerId,
    sourceBaseFingerprint: plateAppearanceBaseFingerprint(snapshot)
  };
}

function plateAppearanceSourceMatchesSnapshot(
  snapshot: DiamondScorebookSnapshot | null,
  source: PlateAppearanceReviewSource,
  authenticatedUid: string | null | undefined
) {
  if (!snapshot) return false;
  const current = buildPlateAppearanceReviewSource(snapshot, authenticatedUid);
  return Boolean(
    current &&
    current.sourceRevision === source.sourceRevision &&
    current.sourceInstanceId === source.sourceInstanceId &&
    current.sourceLeaseId === source.sourceLeaseId &&
    current.authenticatedUid === source.authenticatedUid &&
    current.batterId === source.batterId &&
    current.pitcherId === source.pitcherId &&
    current.sourceBaseFingerprint === source.sourceBaseFingerprint
  );
}

function bindPlateAppearanceReview(snapshot: DiamondScorebookSnapshot, pending: PendingPlay, authenticatedUid: string | null | undefined) {
  if (pending.type !== 'record_plate_appearance' || pending.correction) return pending;
  const source = buildPlateAppearanceReviewSource(snapshot, authenticatedUid);
  return source ? { ...pending, sourceRevision: source.sourceRevision, plateAppearanceSource: source } : null;
}

function buildRunnerAdvanceReviewSource(
  snapshot: DiamondScorebookSnapshot,
  authenticatedUid: string | null | undefined
): RunnerAdvanceReviewSource | null {
  if (!snapshot.authoritative || !isOpenActiveHalf(snapshot)) return null;
  const identity = getQueueIdentity(snapshot, authenticatedUid);
  if (!identity) return null;
  return {
    sourceRevision: snapshot.revision,
    sourceInstanceId: snapshot.instanceId,
    sourceLeaseId: identity.leaseId,
    authenticatedUid: identity.authenticatedUid,
    sourceBaseFingerprint: plateAppearanceBaseFingerprint(snapshot)
  };
}

function runnerAdvanceSourceMatchesSnapshot(
  snapshot: DiamondScorebookSnapshot | null,
  source: RunnerAdvanceReviewSource,
  authenticatedUid: string | null | undefined
) {
  if (!snapshot) return false;
  const current = buildRunnerAdvanceReviewSource(snapshot, authenticatedUid);
  return Boolean(
    current &&
    current.sourceRevision === source.sourceRevision &&
    current.sourceInstanceId === source.sourceInstanceId &&
    current.sourceLeaseId === source.sourceLeaseId &&
    current.authenticatedUid === source.authenticatedUid &&
    current.sourceBaseFingerprint === source.sourceBaseFingerprint
  );
}

function bindRunnerAdvanceReview(snapshot: DiamondScorebookSnapshot, pending: PendingPlay, authenticatedUid: string | null | undefined) {
  if (pending.type !== 'advance_runner' || pending.correction) return pending;
  const source = buildRunnerAdvanceReviewSource(snapshot, authenticatedUid);
  return source ? { ...pending, sourceRevision: source.sourceRevision, runnerAdvanceSource: source } : null;
}

function copyLineupDrafts(snapshot: DiamondScorebookSnapshot | null): LineupDrafts {
  return {
    home: snapshot?.lineups.home.map((entry) => ({ ...entry })) || [],
    away: snapshot?.lineups.away.map((entry) => ({ ...entry })) || []
  };
}

function copyDefenseDrafts(snapshot: DiamondScorebookSnapshot | null): DefenseDrafts {
  const copySide = (side: DiamondSide) =>
    Object.fromEntries(
      Object.entries(snapshot?.defense[side] || {}).map(([position, player]) => [position, player?.playerId || ''])
    ) as Partial<Record<DiamondDefensivePosition, string>>;
  return { home: copySide('home'), away: copySide('away') };
}

function canonicalDefenseAssignments(assignments: Partial<Record<DiamondDefensivePosition, string>>) {
  return defensivePositions.flatMap((position) => {
    const playerId = assignments[position];
    return playerId ? [{ position, playerId }] : [];
  });
}

function defenseFingerprint(assignments: Partial<Record<DiamondDefensivePosition, string>>) {
  return JSON.stringify(canonicalDefenseAssignments(assignments));
}

function defensePersonnelFingerprint(assignments: Partial<Record<DiamondDefensivePosition, string>>) {
  return JSON.stringify(
    canonicalDefenseAssignments(assignments)
      .map((assignment) => assignment.playerId)
      .sort()
  );
}

function activeDefenseDraftForSnapshot(snapshot: DiamondScorebookSnapshot, side: DiamondSide): ActiveDefenseDraft {
  const assignments = copyDefenseDrafts(snapshot)[side];
  return {
    assignments,
    sourceRevision: snapshot.revision,
    sourceInstanceId: snapshot.instanceId,
    sourceLeaseId: snapshot.lease.leaseId || '',
    sourceDefenseFingerprint: defenseFingerprint(assignments),
    sourcePersonnelFingerprint: defensePersonnelFingerprint(assignments)
  };
}

function activeDefenseDraftsForSnapshot(snapshot: DiamondScorebookSnapshot | null): ActiveDefenseDrafts {
  if (!snapshot || snapshot.lifecycle !== 'active') return { home: null, away: null };
  return {
    home: activeDefenseDraftForSnapshot(snapshot, 'home'),
    away: activeDefenseDraftForSnapshot(snapshot, 'away')
  };
}

function activeDefenseDraftMatchesSnapshot(draft: ActiveDefenseDraft, snapshot: DiamondScorebookSnapshot, side: DiamondSide) {
  const current = copyDefenseDrafts(snapshot)[side];
  return Boolean(
    snapshot.lifecycle === 'active' &&
    draft.sourceRevision === snapshot.revision &&
    draft.sourceInstanceId === snapshot.instanceId &&
    draft.sourceLeaseId === (snapshot.lease.leaseId || '') &&
    draft.sourceDefenseFingerprint === defenseFingerprint(current) &&
    draft.sourcePersonnelFingerprint === defensePersonnelFingerprint(current)
  );
}

function activeFieldingSide(snapshot: DiamondScorebookSnapshot): DiamondSide {
  return snapshot.inning.half === 'top' ? 'home' : 'away';
}

function hasAutomaticHomeGameEnding(snapshot: DiamondScorebookSnapshot) {
  if (snapshot.inning.half !== 'bottom' || snapshot.score.home <= snapshot.score.away) return false;
  const profile = resolvePinnedRulesProfile(snapshot);
  if (!profile) return true;
  if (snapshot.inning.number >= profile.scheduledInnings) return true;
  const differential = snapshot.score.home - snapshot.score.away;
  return profile.runAheadRules.some((rule) => snapshot.inning.number >= rule.afterInning && differential >= rule.runDifferential);
}

function isOpenActiveHalf(snapshot: DiamondScorebookSnapshot) {
  return Boolean(
    snapshot.lifecycle === 'active' &&
    snapshot.inning.outs < 3 &&
    !snapshot.halfInningEnd &&
    !snapshot.gameEndDecision &&
    !hasAutomaticHomeGameEnding(snapshot)
  );
}

function battingSideForSnapshot(snapshot: DiamondScorebookSnapshot): DiamondSide {
  return snapshot.inning.half === 'top' ? 'away' : 'home';
}

function liveSubstitutionPlacements(snapshot: DiamondScorebookSnapshot, side: DiamondSide) {
  if (!isOpenActiveHalf(snapshot) || battingSideForSnapshot(snapshot) !== side) return [];
  return diamondBases.flatMap((base) => {
    const runner = snapshot.bases[base];
    return runner ? [{ base, runner }] : [];
  });
}

function liveSubstitutionBaseFingerprint(snapshot: DiamondScorebookSnapshot, side: DiamondSide) {
  if (!isOpenActiveHalf(snapshot) || battingSideForSnapshot(snapshot) !== side) return null;
  return JSON.stringify(
    diamondBases.map((base) => {
      const runner = snapshot.bases[base];
      return {
        base,
        runnerId: runner?.playerId || null,
        chargedToPitcherId: runner?.responsiblePitcherId || null,
        courtesyForPlayerId: runner?.courtesyForPlayerId || null,
        reachedOnEventId: runner?.reachedOnEventId || null
      };
    })
  );
}

function readSubstitutionParticipants(type: SubstitutionCommandType, payload: DiamondJsonObject) {
  const side = payload.side;
  const battingSlot = payload.battingSlot;
  const outgoingPlayerId = type === 'substitute' ? payload.outgoingPlayerId : payload.replacedPlayerId;
  const incomingPlayerId = type === 'substitute' ? payload.incomingPlayerId : payload.starterPlayerId;
  if (
    (side !== 'home' && side !== 'away') ||
    typeof battingSlot !== 'number' ||
    !Number.isInteger(battingSlot) ||
    battingSlot < 1 ||
    typeof outgoingPlayerId !== 'string' ||
    !outgoingPlayerId ||
    typeof incomingPlayerId !== 'string' ||
    !incomingPlayerId ||
    incomingPlayerId === outgoingPlayerId
  ) {
    return null;
  }
  const normalizedSide: DiamondSide = side;
  return { side: normalizedSide, battingSlot, outgoingPlayerId, incomingPlayerId };
}

function buildSubstitutionReviewSource(
  snapshot: DiamondScorebookSnapshot,
  type: SubstitutionCommandType,
  payload: DiamondJsonObject,
  authenticatedUid: string | null | undefined
): SubstitutionReviewSource | null {
  if (!snapshot.authoritative || snapshot.lifecycle !== 'active') return null;
  const identity = getQueueIdentity(snapshot, authenticatedUid);
  const participants = readSubstitutionParticipants(type, payload);
  if (!identity || !participants) return null;
  const entry = snapshot.lineups[participants.side].find((candidate) => candidate.slot === participants.battingSlot);
  if (!entry || entry.playerId !== participants.outgoingPlayerId) return null;
  const defenseAssignments = copyDefenseDrafts(snapshot)[participants.side];
  const outgoingDefensivePosition =
    (Object.entries(defenseAssignments).find(([, playerId]) => playerId === participants.outgoingPlayerId)?.[0] as
      DiamondDefensivePosition | undefined) || null;
  const sourceDefensiveAssignmentCount = Object.keys(defenseAssignments).length;
  if (payload.defensivePosition && !outgoingDefensivePosition && sourceDefensiveAssignmentCount >= maximumDefensiveAssignments) {
    return null;
  }
  const livePlacements = liveSubstitutionPlacements(snapshot, participants.side);
  if (livePlacements.some(({ runner }) => runner.playerId === participants.incomingPlayerId)) return null;
  if (livePlacements.filter(({ runner }) => runner.playerId === participants.outgoingPlayerId).length > 1) return null;
  if (type === 'substitute') {
    if (
      snapshot.lineups[participants.side].some((candidate) => candidate.playerId === participants.incomingPlayerId) ||
      !snapshot.availablePlayers[participants.side].some((candidate) => candidate.playerId === participants.incomingPlayerId)
    ) {
      return null;
    }
  } else {
    const profile = resolvePinnedRulesProfile(snapshot);
    const reentryAvailable = Boolean(
      entry.starterPlayerId === participants.incomingPlayerId &&
      entry.starterPlayerId !== entry.playerId &&
      !snapshot.lineups[participants.side].some(
        (candidate) => candidate.slot !== entry.slot && candidate.playerId === participants.incomingPlayerId
      ) &&
      (profile?.freeSubstitution || (entry.starterReentriesUsed || 0) < (profile?.starterReentryLimit || 0))
    );
    if (!reentryAvailable) return null;
  }
  return {
    commandType: type,
    ...participants,
    sourceRevision: snapshot.revision,
    sourceInstanceId: snapshot.instanceId,
    sourceLeaseId: identity.leaseId,
    authenticatedUid: identity.authenticatedUid,
    outgoingDefensivePosition,
    sourceDefensiveAssignmentCount,
    sourceDefenseFingerprint: defenseFingerprint(defenseAssignments),
    sourceBaseFingerprint: liveSubstitutionBaseFingerprint(snapshot, participants.side),
    transferBase: livePlacements.find(({ runner }) => runner.playerId === participants.outgoingPlayerId)?.base || null
  };
}

function substitutionSourceMatchesSnapshot(
  snapshot: DiamondScorebookSnapshot | null,
  source: SubstitutionReviewSource,
  authenticatedUid: string | null | undefined
) {
  if (!snapshot) return false;
  const payload: DiamondJsonObject =
    source.commandType === 'substitute'
      ? {
          side: source.side,
          battingSlot: source.battingSlot,
          outgoingPlayerId: source.outgoingPlayerId,
          incomingPlayerId: source.incomingPlayerId
        }
      : {
          side: source.side,
          battingSlot: source.battingSlot,
          starterPlayerId: source.incomingPlayerId,
          replacedPlayerId: source.outgoingPlayerId
        };
  const current = buildSubstitutionReviewSource(snapshot, source.commandType, payload, authenticatedUid);
  return Boolean(
    current &&
    current.sourceRevision === source.sourceRevision &&
    current.sourceInstanceId === source.sourceInstanceId &&
    current.sourceLeaseId === source.sourceLeaseId &&
    current.authenticatedUid === source.authenticatedUid &&
    current.outgoingDefensivePosition === source.outgoingDefensivePosition &&
    current.sourceDefensiveAssignmentCount === source.sourceDefensiveAssignmentCount &&
    current.sourceDefenseFingerprint === source.sourceDefenseFingerprint &&
    current.sourceBaseFingerprint === source.sourceBaseFingerprint &&
    current.transferBase === source.transferBase
  );
}

function validateSubstitutionPayload(payload: DiamondJsonObject, source: SubstitutionReviewSource) {
  const participants = readSubstitutionParticipants(source.commandType, payload);
  if (
    !participants ||
    participants.side !== source.side ||
    participants.battingSlot !== source.battingSlot ||
    participants.outgoingPlayerId !== source.outgoingPlayerId ||
    participants.incomingPlayerId !== source.incomingPlayerId
  ) {
    return 'The reviewed substitution no longer matches the exact players and batting slot.';
  }
  if (source.outgoingDefensivePosition === 'P' && payload.defensivePosition !== undefined && payload.defensivePosition !== 'P') {
    return 'A substitution replacing the current pitcher must retain defensive position P.';
  }
  if (
    payload.defensivePosition !== undefined &&
    !source.outgoingDefensivePosition &&
    source.sourceDefensiveAssignmentCount >= maximumDefensiveAssignments
  ) {
    return 'A full ten-player defense requires replacing a current defender or keeping this substitution batting-only.';
  }
  return '';
}

function validateSubstitutionPendingReview(pending: PendingPlay) {
  if (!pending.substitutionSource) return '';
  try {
    return validateSubstitutionPayload(parseEditableProposalPayload(pending), pending.substitutionSource);
  } catch (error) {
    return error instanceof SyntaxError
      ? 'The proposed payload is not valid JSON.'
      : describeError(error, 'The proposed substitution is invalid.');
  }
}

function activeDefensePlayers(snapshot: DiamondScorebookSnapshot, side: DiamondSide) {
  return defensivePositions.flatMap((position, index, positions) => {
    const player = snapshot.defense[side][position];
    if (!player || positions.slice(0, index).some((prior) => snapshot.defense[side][prior]?.playerId === player.playerId)) return [];
    return [player];
  });
}

function activeDefenseSourceMatchesSnapshot(
  snapshot: DiamondScorebookSnapshot | null,
  source: ActiveDefenseReviewSource,
  authenticatedUid: string | null | undefined
) {
  if (!snapshot || !isOpenActiveHalf(snapshot) || !snapshot.authoritative || activeFieldingSide(snapshot) !== source.side) return false;
  const identity = getQueueIdentity(snapshot, authenticatedUid);
  if (
    !identity ||
    identity.authenticatedUid !== source.authenticatedUid ||
    identity.instanceId !== source.sourceInstanceId ||
    identity.leaseId !== source.sourceLeaseId ||
    snapshot.revision !== source.sourceRevision
  ) {
    return false;
  }
  const current = copyDefenseDrafts(snapshot)[source.side];
  return (
    defenseFingerprint(current) === source.sourceDefenseFingerprint &&
    defensePersonnelFingerprint(current) === source.sourcePersonnelFingerprint
  );
}

function validateActiveDefensePayload(payload: DiamondJsonObject, source: ActiveDefenseReviewSource) {
  if (payload.side !== source.side || !Array.isArray(payload.assignments)) return 'The reviewed defensive alignment is invalid.';
  const assignments: Partial<Record<DiamondDefensivePosition, string>> = {};
  const playerIds = new Set<string>();
  for (const entry of payload.assignments) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'The reviewed defensive alignment is invalid.';
    const position = 'position' in entry ? entry.position : null;
    const playerId = 'playerId' in entry ? entry.playerId : null;
    if (
      typeof position !== 'string' ||
      !defensivePositions.some((candidate) => candidate === position) ||
      typeof playerId !== 'string' ||
      !playerId ||
      assignments[position as DiamondDefensivePosition] ||
      playerIds.has(playerId)
    ) {
      return 'The reviewed defensive alignment is invalid.';
    }
    assignments[position as DiamondDefensivePosition] = playerId;
    playerIds.add(playerId);
  }
  if (
    !assignments.P ||
    canonicalDefenseAssignments(assignments).length !== payload.assignments.length ||
    defensePersonnelFingerprint(assignments) !== source.sourcePersonnelFingerprint ||
    defenseFingerprint(assignments) === source.sourceDefenseFingerprint
  ) {
    return 'The reviewed defensive alignment must swap the complete current personnel and retain a pitcher.';
  }
  return '';
}

function buildDiamondAiCommandContext(snapshot: DiamondScorebookSnapshot): DiamondAiCommandContext {
  const playerIds = new Set<string>();
  const addPlayer = (player: DiamondPlayerRef | null | undefined) => {
    if (player?.playerId) playerIds.add(player.playerId);
  };
  addPlayer(snapshot.currentBatter);
  addPlayer(snapshot.currentPitcher);
  addPlayer(snapshot.bases.first);
  addPlayer(snapshot.bases.second);
  addPlayer(snapshot.bases.third);
  snapshot.battingLineup.forEach(addPlayer);
  snapshot.defensiveLineup.forEach(addPlayer);
  snapshot.lineups.home.forEach(addPlayer);
  snapshot.lineups.away.forEach(addPlayer);
  snapshot.availablePlayers.home.forEach(addPlayer);
  snapshot.availablePlayers.away.forEach(addPlayer);
  const normalizedProfileId = snapshot.rulesProfileId.toLowerCase();
  const rulesProfile = resolvePinnedRulesProfile(snapshot);
  return {
    sourceRevision: snapshot.revision,
    sport: normalizedProfileId.includes('fastpitch') || normalizedProfileId.includes('softball') ? 'fastpitch' : 'baseball',
    captureMode: snapshot.captureMode,
    inning: snapshot.inning.number,
    half: snapshot.inning.half,
    outs: snapshot.inning.outs,
    balls: snapshot.inning.balls,
    strikes: snapshot.inning.strikes,
    currentBatterId: snapshot.currentBatter?.playerId || null,
    currentPitcherId: snapshot.currentPitcher?.playerId || null,
    bases: {
      first: snapshot.bases.first?.playerId || null,
      second: snapshot.bases.second?.playerId || null,
      third: snapshot.bases.third?.playerId || null
    },
    ...(rulesProfile
      ? {
          droppedThirdStrike: {
            enabled: rulesProfile.droppedThirdStrike.enabled,
            disallowWhenFirstOccupiedWithFewerThanTwoOuts: rulesProfile.droppedThirdStrike.disallowWhenFirstOccupiedWithFewerThanTwoOuts
          }
        }
      : {}),
    knownPlayerIds: [...playerIds],
    recentPlayIds: snapshot.recentPlays.filter((play) => !play.voided).map((play) => play.eventId)
  };
}

function normalizeServerVoiceProposal(proposal: DiamondVoiceProposal, sourceRevision: number): PendingVoiceProposal {
  return {
    sourceRevision,
    type: proposal.type,
    payload: proposal.payload,
    confidence: proposal.confidence,
    unresolvedQuestions: proposal.unresolvedFields
  };
}

function buildStructuredPending(type: DiamondCommandType, label: string, payload: DiamondJsonObject): PendingPlay {
  return {
    source: 'tap',
    label,
    type,
    payload,
    payloadDraft: JSON.stringify(payload, null, 2),
    result: '',
    runnerMoves: [],
    outsOnPlay: 0,
    runsBattedIn: 0,
    putoutBy: '',
    assistBy: '',
    errorBy: '',
    battedBall: 'unknown',
    unresolvedFields: [],
    ambiguityConfirmed: true,
    aiConfidence: null,
    sourceRevision: null
  };
}

function playerLabel(player: DiamondPlayerRef | null) {
  if (!player) return 'Not set';
  return `${player.number ? `#${player.number} ` : ''}${player.name}`;
}

function snapshotSidePlayer(snapshot: DiamondScorebookSnapshot, side: DiamondSide, playerId: string): DiamondPlayerRef | null {
  const defensivePlayers = Object.values(snapshot.defense[side]).flatMap((player) => (player ? [player] : []));
  return (
    [...defensivePlayers, ...snapshot.lineups[side], ...snapshot.availablePlayers[side]].find((player) => player.playerId === playerId) ||
    null
  );
}

function snapshotSidePlayers(snapshot: DiamondScorebookSnapshot, side: DiamondSide): DiamondPlayerRef[] {
  const defensivePlayers = Object.values(snapshot.defense[side]).flatMap((player) => (player ? [player] : []));
  return [...defensivePlayers, ...snapshot.lineups[side], ...snapshot.availablePlayers[side]]
    .filter((player) => {
      const claimedSides = snapshotClaimedPlayerSides(snapshot, player.playerId);
      return claimedSides.length === 0 || (claimedSides.length === 1 && claimedSides[0] === side);
    })
    .filter((player, index, all) => all.findIndex((candidate) => candidate.playerId === player.playerId) === index);
}

function oppositeDiamondSide(side: DiamondSide): DiamondSide {
  return side === 'home' ? 'away' : 'home';
}

function snapshotClaimedPlayerSides(snapshot: DiamondScorebookSnapshot, playerId: string): DiamondSide[] {
  const battingSide: DiamondSide = snapshot.inning.half === 'bottom' ? 'home' : 'away';
  const fieldingSide = oppositeDiamondSide(battingSide);
  const claims = new Set<DiamondSide>();
  for (const side of ['home', 'away'] as const) {
    if (
      snapshot.lineups[side].some(
        (entry) => entry.playerId === playerId || entry.starterPlayerId === playerId || entry.substitutions?.includes(playerId)
      ) ||
      snapshot.courtesyRunnerIds?.[side]?.includes(playerId) ||
      Object.values(snapshot.defense[side]).some((player) => player?.playerId === playerId)
    ) {
      claims.add(side);
    }
  }
  for (const placement of Object.values(snapshot.bases)) {
    if (placement?.playerId === playerId || placement?.courtesyForPlayerId === playerId) claims.add(battingSide);
    if (placement?.responsiblePitcherId === playerId) claims.add(fieldingSide);
  }
  if (snapshot.currentBatter?.playerId === playerId) claims.add(battingSide);
  if (snapshot.currentPitcher?.playerId === playerId) claims.add(fieldingSide);
  return [...claims];
}

function correctionBattingSide(snapshot: DiamondScorebookSnapshot, batterId: string, pitcherId: string): DiamondSide | null {
  const batterSides = snapshotClaimedPlayerSides(snapshot, batterId);
  const pitcherSides = snapshotClaimedPlayerSides(snapshot, pitcherId);
  if (batterSides.length === 1) {
    const side = batterSides[0]!;
    return pitcherSides.length === 0 || (pitcherSides.length === 1 && pitcherSides[0] === oppositeDiamondSide(side)) ? side : null;
  }
  if (batterSides.length === 0 && pitcherSides.length === 1) return oppositeDiamondSide(pitcherSides[0]!);
  return null;
}

function structuredEventBattingSide(snapshot: DiamondScorebookSnapshot, event: DiamondEffectivePrivateEvent): DiamondSide | null {
  if (event.effectiveType === 'record_plate_appearance') {
    return correctionBattingSide(snapshot, readString(event.effectivePayload.batterId), readString(event.effectivePayload.pitcherId));
  }
  if (event.effectiveType === 'advance_runner') {
    const runnerSides = snapshotClaimedPlayerSides(snapshot, readString(event.effectivePayload.runnerId));
    if (runnerSides.length === 1) return runnerSides[0]!;
    if (runnerSides.length > 1) return null;
    const runnerId = readString(event.effectivePayload.runnerId);
    const candidateSides = (['home', 'away'] as const).filter((side) =>
      snapshot.availablePlayers[side].some((player) => player.playerId === runnerId)
    );
    return candidateSides.length === 1 ? candidateSides[0]! : null;
  }
  return null;
}

function inningLabel(snapshot: DiamondScorebookSnapshot) {
  return `${snapshot.inning.half === 'top' ? 'Top' : 'Bottom'} ${snapshot.inning.number}`;
}

function describeError(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function getDefaultDestination(
  result: string,
  from: RunnerMoveDraft['from'],
  occupiedBases: Set<RunnerMoveDraft['from']>
): RunnerDestination {
  if (from === 'batter') return outcomeOptions.find((option) => option.result === result)?.batterTo || 'first';
  if (result === 'home_run' || result === 'triple') return 'home';
  if (result === 'double') return from === 'first' ? 'third' : 'home';
  if (result === 'single') return from === 'first' ? 'second' : from === 'second' ? 'third' : 'home';
  if (result === 'walk' || result === 'intentional_walk' || result === 'hit_by_pitch' || result === 'interference') {
    if (from === 'third') return occupiedBases.has('first') && occupiedBases.has('second') ? 'home' : 'stay';
    if (from === 'second') return occupiedBases.has('first') ? 'third' : 'stay';
    if (from === 'first') return 'second';
  }
  if (result === 'double_play' && from === 'first') return 'out';
  if (result === 'fielders_choice' && from === 'first') return 'out';
  return 'stay';
}

function defaultRunnerCause(result: string, to: RunnerDestination): DiamondRunnerAdvanceCause {
  if (result === 'walk' || result === 'intentional_walk') return 'walk';
  if (result === 'hit_by_pitch') return 'hit_by_pitch';
  if (result === 'reached_on_error') return 'error';
  if (result === 'interference') return 'obstruction';
  if (to === 'out' && ['fielders_choice', 'double_play', 'triple_play'].includes(result)) return 'force_out';
  if (result === 'dropped_third_strike') return 'other';
  return 'batted_ball';
}

function defaultOutKind(result: string, from: RunnerMoveDraft['from']): DiamondOutKind {
  if (from !== 'batter') return ['fielders_choice', 'double_play', 'triple_play'].includes(result) ? 'force' : 'tag';
  if (result === 'strikeout' || result === 'dropped_third_strike') return 'strikeout';
  if (result === 'fly_out' || result === 'line_out' || result === 'sacrifice_fly') return 'catch';
  return 'batter_runner';
}

function defaultScoringAdvanceRbi(result: string, cause: DiamondRunnerAdvanceCause) {
  if (['reached_on_error', 'double_play', 'triple_play'].includes(result)) return false;
  if (cause === 'obstruction') return result === 'interference';
  return cause === 'batted_ball' || cause === 'walk' || cause === 'hit_by_pitch';
}

function requiresHomeRunRbi(result: string, move: Pick<RunnerMoveDraft, 'to' | 'countsRun'>) {
  return result === 'home_run' && move.to === 'home' && move.countsRun !== false;
}

function reviewedMoveHasRbi(result: string, move: Pick<RunnerMoveDraft, 'to' | 'countsRun' | 'rbi'>) {
  return requiresHomeRunRbi(result, move) || move.rbi === true;
}

function forceHomeRunRbis(result: string, moves: RunnerMoveDraft[]) {
  if (result !== 'home_run') return moves;
  return moves.map((move) => (requiresHomeRunRbi(result, move) ? { ...move, rbi: true } : move));
}

function buildRunnerMoves(snapshot: DiamondScorebookSnapshot, result: string): RunnerMoveDraft[] {
  const occupiedBases = new Set<RunnerMoveDraft['from']>();
  (['first', 'second', 'third'] as const).forEach((base) => {
    if (snapshot.bases[base]) occupiedBases.add(base);
  });
  const batter = snapshot.currentBatter;
  const droppedThirdStrike = resolvePinnedRulesProfile(snapshot)?.droppedThirdStrike;
  const batterDestination =
    result === 'dropped_third_strike' &&
    (!droppedThirdStrike?.enabled ||
      (droppedThirdStrike.disallowWhenFirstOccupiedWithFewerThanTwoOuts && snapshot.bases.first && snapshot.inning.outs < 2))
      ? 'out'
      : getDefaultDestination(result, 'batter', occupiedBases);
  const batterCause = defaultRunnerCause(result, batterDestination);
  const moves: RunnerMoveDraft[] = batter
    ? [
        {
          key: `batter:${batter.playerId}`,
          label: `Batter · ${playerLabel(batter)}`,
          playerId: batter.playerId,
          from: 'batter',
          to: batterDestination,
          cause: batterCause,
          ...(batterDestination === 'out' ? { outKind: defaultOutKind(result, 'batter') } : {}),
          ...(batterDestination === 'home'
            ? {
                countsRun: true,
                rbi: defaultScoringAdvanceRbi(result, batterCause),
                responsiblePitcherId: snapshot.currentPitcher?.playerId
              }
            : {})
        }
      ]
    : [];
  (['third', 'second', 'first'] as const).forEach((base) => {
    const runner = snapshot.bases[base];
    if (!runner) return;
    const destination = getDefaultDestination(result, base, occupiedBases);
    const cause = defaultRunnerCause(result, destination);
    moves.push({
      key: `${base}:${runner.playerId}`,
      label: `${base[0]!.toUpperCase()}${base.slice(1)} · ${playerLabel(runner)}`,
      playerId: runner.playerId,
      from: base,
      to: destination,
      cause,
      ...(destination === 'out' ? { outKind: defaultOutKind(result, base) } : {}),
      ...(destination === 'home'
        ? {
            countsRun: true,
            rbi: defaultScoringAdvanceRbi(result, cause),
            responsiblePitcherId: runner.responsiblePitcherId || snapshot.currentPitcher?.playerId
          }
        : {})
    });
  });
  const requiredOuts = outcomeOptions.find((option) => option.result === result)?.outs || 0;
  if (requiredOuts > moves.filter((move) => move.to === 'out').length) {
    const extraOuts = moves
      .filter((move) => move.from !== 'batter' && move.to !== 'out')
      .sort((left, right) => ['first', 'second', 'third'].indexOf(left.from) - ['first', 'second', 'third'].indexOf(right.from))
      .slice(0, requiredOuts - moves.filter((move) => move.to === 'out').length);
    extraOuts.forEach((move) => {
      move.to = 'out';
      move.cause = 'force_out';
      move.outKind = 'force';
      move.countsRun = undefined;
      move.rbi = undefined;
      move.earned = undefined;
    });
  }
  return moves;
}

function buildPendingOutcome(snapshot: DiamondScorebookSnapshot, option: OutcomeOption, source: 'tap' | 'voice' = 'tap'): PendingPlay {
  const runnerMoves = buildRunnerMoves(snapshot, option.result);
  const homeMoves = runnerMoves.filter((move) => move.to === 'home' && move.rbi).length;
  return {
    source,
    label: option.label,
    type: 'record_plate_appearance',
    payload: {},
    payloadDraft: '{}',
    result: option.result,
    runnerMoves,
    outsOnPlay: option.outs,
    runsBattedIn: option.result === 'reached_on_error' ? 0 : homeMoves,
    putoutBy: '',
    assistBy: '',
    errorBy: '',
    battedBall: option.result.includes('ground') ? 'ground' : option.result.includes('fly') ? 'fly' : 'unknown',
    unresolvedFields: [],
    ambiguityConfirmed: true,
    aiConfidence: null,
    sourceRevision: null
  };
}

function retargetCorrectionOutcome(pending: PendingPlay, option: OutcomeOption): PendingPlay {
  const occupiedBases = new Set(pending.runnerMoves.flatMap((move) => (move.from === 'batter' ? [] : [move.from])));
  const runnerMoves = pending.runnerMoves.map((move): RunnerMoveDraft => {
    const to = getDefaultDestination(option.result, move.from, occupiedBases);
    const cause = defaultRunnerCause(option.result, to);
    return {
      ...move,
      to,
      cause,
      ...(to === 'out' ? { outKind: defaultOutKind(option.result, move.from) } : { outKind: undefined }),
      ...(to === 'home'
        ? {
            countsRun: true,
            rbi: defaultScoringAdvanceRbi(option.result, cause),
            ...(move.responsiblePitcherId ? { responsiblePitcherId: move.responsiblePitcherId } : {}),
            ...(typeof move.earned === 'boolean' ? { earned: move.earned } : {})
          }
        : { countsRun: undefined, rbi: undefined, responsiblePitcherId: undefined, earned: undefined })
    };
  });
  const recordedOuts = runnerMoves.filter((move) => move.to === 'out').length;
  if (option.outs > recordedOuts) {
    runnerMoves
      .filter((move) => move.from !== 'batter' && move.to !== 'out')
      .sort((left, right) => ['first', 'second', 'third'].indexOf(left.from) - ['first', 'second', 'third'].indexOf(right.from))
      .slice(0, option.outs - recordedOuts)
      .forEach((move) => {
        move.to = 'out';
        move.cause = 'force_out';
        move.outKind = 'force';
        move.countsRun = undefined;
        move.rbi = undefined;
        move.responsiblePitcherId = undefined;
        move.earned = undefined;
      });
  }
  return {
    ...pending,
    label: `${option.label} replacement`,
    result: option.result,
    runnerMoves,
    outsOnPlay: runnerMoves.filter((move) => move.to === 'out').length,
    runsBattedIn: runnerMoves.filter((move) => move.to === 'home' && move.rbi).length
  };
}

function buildPendingPlateAppearanceCorrection(
  snapshot: DiamondScorebookSnapshot,
  event: DiamondEffectivePrivateEvent,
  reason: string
): PendingPlay {
  const payload = event.effectivePayload as Record<string, unknown>;
  const result = readString(payload.result);
  const option = outcomeOptions.find((candidate) => candidate.result === result);
  if (!option) throw new Error('This plate-appearance result cannot be edited with the standard correction form.');
  const batterId = readString(payload.batterId);
  const pitcherId = readString(payload.pitcherId);
  const battingSide = correctionBattingSide(snapshot, batterId, pitcherId);
  const labelForId = (playerId: string, role: string) => {
    const player = (battingSide && snapshotSidePlayer(snapshot, battingSide, playerId)) || { playerId, name: playerId };
    return `${role} · ${playerLabel(player)}`;
  };
  const batterAdvance = asJsonObject(payload.batterAdvance);
  const runnerMoves = forceHomeRunRbis(result, [
    {
      key: `batter:${batterId}`,
      label: labelForId(batterId, 'Batter'),
      playerId: batterId,
      from: 'batter',
      to: readString(batterAdvance.to) as RunnerDestination,
      cause: (readString(batterAdvance.cause) ||
        defaultRunnerCause(result, readString(batterAdvance.to) as RunnerDestination)) as DiamondRunnerAdvanceCause,
      ...(readString(batterAdvance.outKind) ? { outKind: readString(batterAdvance.outKind) as DiamondOutKind } : {}),
      ...(typeof batterAdvance.countsRun === 'boolean' ? { countsRun: batterAdvance.countsRun } : {}),
      ...(typeof batterAdvance.earned === 'boolean' ? { earned: batterAdvance.earned } : {}),
      ...(typeof batterAdvance.rbi === 'boolean' ? { rbi: batterAdvance.rbi } : {}),
      ...(readString(batterAdvance.responsiblePitcherId) ? { responsiblePitcherId: readString(batterAdvance.responsiblePitcherId) } : {})
    },
    ...(Array.isArray(payload.runnerAdvances) ? payload.runnerAdvances : []).flatMap((value) => {
      const advance = asJsonObject(value);
      const runnerId = readString(advance.runnerId);
      const from = readString(advance.from) as RunnerMoveDraft['from'];
      const to = readString(advance.to) as RunnerDestination;
      if (!runnerId || !['first', 'second', 'third'].includes(from) || !destinationOptions.some((candidate) => candidate.value === to))
        return [];
      return [
        {
          key: `${from}:${runnerId}`,
          label: labelForId(runnerId, `${from[0]!.toUpperCase()}${from.slice(1)}`),
          playerId: runnerId,
          from,
          to,
          cause: (readString(advance.cause) || defaultRunnerCause(result, to)) as DiamondRunnerAdvanceCause,
          ...(readString(advance.outKind) ? { outKind: readString(advance.outKind) as DiamondOutKind } : {}),
          ...(typeof advance.countsRun === 'boolean' ? { countsRun: advance.countsRun } : {}),
          ...(typeof advance.earned === 'boolean' ? { earned: advance.earned } : {}),
          ...(typeof advance.rbi === 'boolean' ? { rbi: advance.rbi } : {}),
          ...(readString(advance.responsiblePitcherId) ? { responsiblePitcherId: readString(advance.responsiblePitcherId) } : {})
        } satisfies RunnerMoveDraft
      ];
    })
  ]);
  const fielding = asJsonObject(payload.fielding);
  const assists = Array.isArray(fielding.assists) ? fielding.assists.map(readString).filter(Boolean) : [];
  const errors = Array.isArray(fielding.errors) ? fielding.errors.map(asJsonObject) : [];
  return {
    source: 'tap',
    label: `${option.label} replacement`,
    type: 'record_plate_appearance',
    payload: event.effectivePayload,
    payloadDraft: JSON.stringify(event.effectivePayload, null, 2),
    result,
    runnerMoves,
    outsOnPlay: readNumber(payload.outsOnPlay, runnerMoves.filter((move) => move.to === 'out').length),
    runsBattedIn: readNumber(payload.runsBattedIn, runnerMoves.filter((move) => move.to === 'home' && move.rbi).length),
    putoutBy: readString(fielding.putoutBy),
    assistBy: assists[0] || '',
    errorBy: readString(errors[0]?.playerId),
    battedBall: readString(fielding.battedBall) || 'unknown',
    unresolvedFields: [],
    ambiguityConfirmed: true,
    aiConfidence: null,
    sourceRevision: null,
    batterId,
    pitcherId,
    correction: { targetEventId: event.sourceEventId, reason }
  };
}

function asJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function readNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function containsSensitiveProposalField(value: unknown, key = ''): boolean {
  if (/(audio|recording|transcript|private.?note)/i.test(key)) return true;
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveProposalField(entry));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([entryKey, entry]) => containsSensitiveProposalField(entry, entryKey));
  }
  return false;
}

function parseEditableProposalPayload(pending: PendingPlay): DiamondJsonObject {
  const parsed = JSON.parse(pending.payloadDraft) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('The proposed payload must be a JSON object.');
  }
  if (containsSensitiveProposalField(parsed)) {
    throw new Error('Audio, transcripts, and private notes cannot be included in a scoring command.');
  }
  return parsed as DiamondJsonObject;
}

function buildPendingVoicePlay(snapshot: DiamondScorebookSnapshot, proposal: PendingVoiceProposal): PendingPlay {
  const payload = proposal.payload as Record<string, unknown>;
  const result = readString(payload.result);
  const knownOutcome = outcomeOptions.find((option) => option.result === result);
  if (proposal.type === 'record_plate_appearance' && knownOutcome) {
    const pending = buildPendingOutcome(snapshot, knownOutcome, 'voice');
    const batterAdvance =
      payload.batterAdvance && typeof payload.batterAdvance === 'object' ? (payload.batterAdvance as Record<string, unknown>) : {};
    const runnerAdvances = Array.isArray(payload.runnerAdvances) ? payload.runnerAdvances : [];
    pending.runnerMoves = forceHomeRunRbis(
      result,
      pending.runnerMoves.map((move) => {
        if (move.from === 'batter') {
          const to = readString(batterAdvance.to) as RunnerDestination;
          const nextTo = destinationOptions.some((option) => option.value === to) ? to : move.to;
          const earned = typeof batterAdvance.earned === 'boolean' ? batterAdvance.earned : move.earned;
          const cause = readString(batterAdvance.cause) as DiamondRunnerAdvanceCause;
          const nextCause = runnerCauseOptions.some((option) => option.value === cause) ? cause : move.cause;
          const countsRun = typeof batterAdvance.countsRun === 'boolean' ? batterAdvance.countsRun : move.countsRun;
          const outKind = readString(batterAdvance.outKind) as DiamondOutKind;
          return {
            ...move,
            to: nextTo,
            cause: nextCause,
            ...(nextTo !== 'out' ? { outKind: undefined } : {}),
            ...(nextTo === 'out' && outKindOptions.some((option) => option.value === outKind) ? { outKind } : {}),
            ...(typeof batterAdvance.countsRun === 'boolean' ? { countsRun } : {}),
            ...(typeof batterAdvance.rbi === 'boolean'
              ? { rbi: batterAdvance.rbi }
              : nextTo === 'home'
                ? { rbi: countsRun === true && defaultScoringAdvanceRbi(result, nextCause) }
                : {}),
            ...(readString(batterAdvance.responsiblePitcherId)
              ? { responsiblePitcherId: readString(batterAdvance.responsiblePitcherId) }
              : {}),
            earned
          };
        }
        const proposedMove = runnerAdvances.find(
          (entry) => entry && typeof entry === 'object' && readString((entry as Record<string, unknown>).runnerId) === move.playerId
        ) as Record<string, unknown> | undefined;
        const to = readString(proposedMove?.to) as RunnerDestination;
        const nextTo = destinationOptions.some((option) => option.value === to) ? to : move.to;
        const earned = typeof proposedMove?.earned === 'boolean' ? proposedMove.earned : move.earned;
        const cause = readString(proposedMove?.cause) as DiamondRunnerAdvanceCause;
        const nextCause = runnerCauseOptions.some((option) => option.value === cause) ? cause : move.cause;
        const countsRun = typeof proposedMove?.countsRun === 'boolean' ? proposedMove.countsRun : move.countsRun;
        const outKind = readString(proposedMove?.outKind) as DiamondOutKind;
        return {
          ...move,
          to: nextTo,
          cause: nextCause,
          ...(nextTo !== 'out' ? { outKind: undefined } : {}),
          ...(nextTo === 'out' && outKindOptions.some((option) => option.value === outKind) ? { outKind } : {}),
          ...(typeof proposedMove?.countsRun === 'boolean' ? { countsRun } : {}),
          ...(typeof proposedMove?.rbi === 'boolean'
            ? { rbi: proposedMove.rbi }
            : nextTo === 'home'
              ? { rbi: countsRun === true && defaultScoringAdvanceRbi(result, nextCause) }
              : {}),
          ...(readString(proposedMove?.responsiblePitcherId)
            ? { responsiblePitcherId: readString(proposedMove?.responsiblePitcherId) }
            : {}),
          earned
        };
      })
    );
    pending.outsOnPlay = readNumber(payload.outsOnPlay, pending.outsOnPlay);
    pending.runsBattedIn =
      result === 'home_run'
        ? pending.runnerMoves.filter((move) => move.to === 'home' && move.countsRun !== false).length
        : readNumber(
            payload.runsBattedIn,
            pending.runnerMoves.filter((move) => move.to === 'home' && move.countsRun !== false && move.rbi).length
          );
    pending.unresolvedFields = proposal.unresolvedQuestions;
    pending.ambiguityConfirmed = proposal.unresolvedQuestions.length === 0;
    pending.payload = proposal.payload;
    pending.payloadDraft = JSON.stringify(proposal.payload, null, 2);
    pending.aiConfidence = proposal.confidence;
    pending.sourceRevision = proposal.sourceRevision;
    return pending;
  }
  return {
    source: 'voice',
    label: proposal.type.replace(/_/g, ' '),
    type: proposal.type,
    payload: proposal.payload,
    payloadDraft: JSON.stringify(proposal.payload, null, 2),
    result,
    runnerMoves: [],
    outsOnPlay: 0,
    runsBattedIn: 0,
    putoutBy: '',
    assistBy: '',
    errorBy: '',
    battedBall: 'unknown',
    unresolvedFields: proposal.unresolvedQuestions,
    ambiguityConfirmed: proposal.unresolvedQuestions.length === 0,
    aiConfidence: proposal.confidence,
    sourceRevision: proposal.sourceRevision
  };
}

function validateRunnerReview(pending: PendingPlay, snapshot: DiamondScorebookSnapshot) {
  if (pending.type !== 'record_plate_appearance') {
    try {
      const payload = parseEditableProposalPayload(pending);
      if (pending.type === 'record_pitch' && !pending.correction && plateAppearanceRequiresResolution(snapshot)) {
        return 'Resolve the pending plate appearance before recording another pitch.';
      }
      if (pending.type === 'advance_runner') {
        const from = readString(payload.from);
        const to = readString(payload.to);
        const runnerId = readString(payload.runnerId);
        const cause = readString(payload.cause) as DiamondRunnerAdvanceCause;
        if (!diamondBases.includes(from as DiamondBase) || !destinationOptions.some((option) => option.value === to)) {
          return 'The proposed runner origin or destination is invalid.';
        }
        if (!canChooseDestination(from as DiamondBase, to as RunnerDestination)) {
          return 'A runner must stay put or move forward to a later base, reach home, or be recorded out.';
        }
        if (!runnerCauseOptions.some((option) => option.value === cause)) {
          return 'The proposed runner event is invalid.';
        }
        if (!canChooseRunnerCauseDestination(cause, to as RunnerDestination)) {
          return 'The selected runner event does not match its destination.';
        }
        if (
          !canChooseAdvanceCauseOutKind(cause, to as RunnerDestination, readString(payload.outKind) as DiamondOutKind, from as DiamondBase)
        ) {
          return 'The selected runner event does not match its out kind.';
        }
        if (!pending.correction && snapshot.bases[from as DiamondBase]?.playerId !== runnerId) {
          return 'The proposed runner must match the exact current base before this play.';
        }
        if (!pending.correction && diamondBases.includes(to as DiamondBase) && snapshot.bases[to as DiamondBase]) {
          return 'The proposed runner destination is already occupied in the current base state.';
        }
        if (
          !pending.correction &&
          hasRunnerOrderViolation(
            diamondBases.flatMap((base) =>
              snapshot.bases[base] ? [{ from: base, to: base === from ? (to as RunnerDestination) : ('stay' as const) }] : []
            )
          )
        ) {
          return 'A trailing runner cannot pass a preceding runner. Review every runner destination.';
        }
      }
      return '';
    } catch (error) {
      return error instanceof SyntaxError
        ? 'The proposed payload is not valid JSON.'
        : describeError(error, 'The proposed payload is invalid.');
    }
  }
  const batterMoves = pending.runnerMoves.filter((move) => move.from === 'batter');
  if (batterMoves.length !== 1) {
    return 'The current batter is missing. Refresh the scorebook before recording this play.';
  }
  if (pending.runnerMoves.some((move) => !canChooseDestination(move.from, move.to))) {
    return 'A runner must stay put or move forward to a later base, reach home, or be recorded out.';
  }
  if (pending.runnerMoves.some((move) => !canChooseRunnerCauseDestination(move.cause, move.to))) {
    return 'The selected runner event does not match its destination.';
  }
  if (pending.runnerMoves.some((move) => !canChooseAdvanceCauseOutKind(move.cause, move.to, move.outKind, move.from))) {
    return 'The selected runner event does not match its out kind.';
  }
  const batterMove = batterMoves[0]!;
  if (!canChooseBatterDestination(pending.result, batterMove.to)) {
    return 'The batter destination does not match the selected play result.';
  }
  const requiredBatterOutKind = diamondRequiredBatterOutKind(pending.result as DiamondPlateAppearanceResult);
  if (batterMove.to === 'out' && requiredBatterOutKind && batterMove.outKind !== requiredBatterOutKind) {
    return `${pending.result} requires batter out kind ${requiredBatterOutKind}.`;
  }
  const advancesOnDroppedThirdStrike =
    (pending.result === 'strikeout' && batterMove.to === 'first') || (pending.result === 'dropped_third_strike' && batterMove.to !== 'out');
  if (!pending.correction && advancesOnDroppedThirdStrike) {
    const profile = resolvePinnedRulesProfile(snapshot);
    if (!profile?.droppedThirdStrike.enabled) {
      return 'Dropped-third-strike advancement is disabled or unavailable in the pinned rules profile.';
    }
    if (profile.droppedThirdStrike.disallowWhenFirstOccupiedWithFewerThanTwoOuts && snapshot.bases.first && snapshot.inning.outs < 2) {
      return 'Dropped-third-strike advancement is not allowed with first occupied and fewer than two outs.';
    }
  }
  const existingRunnerMoves = pending.runnerMoves.filter((move) => move.from !== 'batter');
  if (!pending.correction) {
    if (pending.source === 'voice') {
      const proposedRunnerAdvances = Array.isArray(pending.payload.runnerAdvances) ? pending.payload.runnerAdvances : [];
      const proposedSources = new Set<string>();
      const proposedRunners = new Set<string>();
      for (const value of proposedRunnerAdvances) {
        const advance = asJsonObject(value);
        const from = readString(advance.from);
        const runnerId = readString(advance.runnerId);
        if (
          !diamondBases.includes(from as DiamondBase) ||
          !runnerId ||
          snapshot.bases[from as DiamondBase]?.playerId !== runnerId ||
          proposedSources.has(from) ||
          proposedRunners.has(runnerId)
        ) {
          return 'Every proposed runner must match the exact current base before this play.';
        }
        proposedSources.add(from);
        proposedRunners.add(runnerId);
      }
    }
    const expectedRunnerSources = diamondBases.flatMap((base) => {
      const runner = snapshot.bases[base];
      return runner ? [`${base}:${runner.playerId}`] : [];
    });
    const reviewedRunnerSources = existingRunnerMoves.map((move) => `${move.from}:${move.playerId}`);
    if (
      reviewedRunnerSources.length !== expectedRunnerSources.length ||
      new Set(reviewedRunnerSources).size !== reviewedRunnerSources.length ||
      new Set(existingRunnerMoves.map((move) => move.playerId)).size !== existingRunnerMoves.length ||
      expectedRunnerSources.some((source) => !reviewedRunnerSources.includes(source))
    ) {
      return 'Every runner who occupied a base before this play must be reviewed exactly once. Refresh and review the play again.';
    }
    if (pending.result === 'sacrifice_bunt' || pending.result === 'sacrifice_fly') {
      if (snapshot.inning.outs >= 2) return 'A sacrifice cannot be recorded with two outs before the play.';
      if (pending.result === 'sacrifice_fly' && !existingRunnerMoves.some((move) => move.to === 'home' && move.countsRun !== false)) {
        return 'A sacrifice fly requires a runner whose run scores on the play.';
      }
      if (
        pending.result === 'sacrifice_bunt' &&
        !existingRunnerMoves.some(
          (move) =>
            (move.to === 'home' && move.countsRun !== false) ||
            (diamondBases.includes(move.to as DiamondBase) &&
              diamondBases.indexOf(move.to as DiamondBase) > diamondBases.indexOf(move.from as DiamondBase))
        )
      ) {
        return 'A sacrifice bunt requires an existing runner to advance safely.';
      }
    }
  }
  if (
    (pending.result === 'home_run' || pending.result === 'triple') &&
    existingRunnerMoves.some((move) => move.to !== 'home' && move.to !== 'out')
  ) {
    return 'Every occupied runner on a home run or triple must reach home or be marked out.';
  }
  const occupiedDestinations = pending.runnerMoves
    .map((move) => (move.to === 'stay' ? move.from : move.to))
    .filter((destination) => destination === 'first' || destination === 'second' || destination === 'third');
  if (new Set(occupiedDestinations).size !== occupiedDestinations.length) {
    return 'Two runners cannot finish on the same base. Review every runner destination.';
  }
  if (hasRunnerOrderViolation(pending.runnerMoves)) {
    return 'A trailing runner cannot pass a preceding runner. Review every runner destination.';
  }
  const computedOuts = pending.runnerMoves.filter((move) => move.to === 'out').length;
  const requiredOuts = pending.result === 'double_play' ? 2 : pending.result === 'triple_play' ? 3 : null;
  if (requiredOuts !== null) {
    const uniqueOutSources = new Set(pending.runnerMoves.flatMap((move) => (move.to === 'out' ? [`${move.from}:${move.playerId}`] : [])));
    if (batterMoves[0]!.to !== 'out' || computedOuts !== requiredOuts || uniqueOutSources.size !== requiredOuts) {
      return `${pending.result === 'double_play' ? 'Double play' : 'Triple play'} must record exactly ${requiredOuts} unique outs, including the batter.`;
    }
  }
  if (pending.outsOnPlay !== computedOuts) return 'Outs on play must exactly match the runners marked out.';
  if (!pending.correction && snapshot.inning.outs + pending.outsOnPlay > 3) {
    return 'This play would record more than three outs in the half inning.';
  }
  const scored = pending.runnerMoves.filter((move) => move.to === 'home').length;
  const rbi = pending.runnerMoves.filter((move) => move.to === 'home' && reviewedMoveHasRbi(pending.result, move)).length;
  if (pending.runsBattedIn !== rbi) return 'RBI total must match the individual runners credited with an RBI.';
  if (rbi > scored) return 'RBI credit cannot exceed the runners marked safe at home.';
  if (pending.runnerMoves.some((move) => move.to === 'out' && !move.outKind)) return 'Choose an out kind for every runner marked out.';
  if (pending.runnerMoves.some((move) => move.to !== 'out' && move.outKind)) return 'Only runners marked out may have an out kind.';
  if (pending.runnerMoves.some((move) => move.to === 'home' && typeof move.countsRun !== 'boolean')) {
    return 'Choose whether every runner crossing home counts.';
  }
  const outMoves = pending.runnerMoves.filter((move) => move.to === 'out');
  const thirdOutCancellationIsProvable =
    !pending.correction &&
    snapshot.inning.outs + pending.outsOnPlay === 3 &&
    outMoves.length > 0 &&
    outMoves.every(diamondOutNecessarilyCancelsRun);
  if (thirdOutCancellationIsProvable && pending.runnerMoves.some((move) => move.to === 'home' && move.countsRun !== false)) {
    return 'A run cannot count when every possible third out is a force or retires the batter-runner before first.';
  }
  return '';
}

function canChooseDestination(from: RunnerMoveDraft['from'], destination: RunnerDestination) {
  if (from === 'batter') return destination !== 'stay';
  if (destination === 'stay' || destination === 'home' || destination === 'out') return true;
  if (from === 'first') return destination === 'second' || destination === 'third';
  if (from === 'second') return destination === 'third';
  return false;
}

function canChooseRunnerCauseDestination(cause: DiamondRunnerAdvanceCause, destination: RunnerDestination) {
  if (outOnlyRunnerCauses.has(cause)) return destination === 'out';
  if (cause === 'stolen_base') return destination !== 'stay' && destination !== 'out';
  return true;
}

function canChooseAdvanceCauseOutKind(
  cause: DiamondRunnerAdvanceCause,
  destination: RunnerDestination,
  outKind: DiamondOutKind | undefined,
  from: RunnerMoveDraft['from']
) {
  const expected = from === 'batter' ? diamondRequiredBatterAdvanceOutKind(cause) : requiredRunnerOutKinds.get(cause);
  return destination !== 'out' || !expected || outKind === expected;
}

function requiredReviewOutKind(result: string, move: Pick<RunnerMoveDraft, 'from' | 'cause'>): DiamondOutKind | null {
  if (move.from === 'batter') {
    return diamondRequiredBatterOutKind(result as DiamondPlateAppearanceResult) || diamondRequiredBatterAdvanceOutKind(move.cause);
  }
  return requiredRunnerOutKinds.get(move.cause) ?? null;
}

function hasRunnerOrderViolation(moves: ReadonlyArray<Pick<RunnerMoveDraft, 'from' | 'to'>>) {
  const survivingRunners = moves
    .filter((move) => move.to !== 'out')
    .map((move) => {
      const originRank = move.from === 'batter' ? 0 : diamondBases.indexOf(move.from) + 1;
      const resolvedDestination = move.to === 'stay' ? move.from : move.to;
      const destinationRank =
        resolvedDestination === 'home' ? diamondBases.length + 1 : diamondBases.indexOf(resolvedDestination as DiamondBase) + 1;
      return { originRank, destinationRank };
    })
    .sort((left, right) => left.originRank - right.originRank);
  return survivingRunners.some((trailingRunner, trailingIndex) =>
    survivingRunners.slice(trailingIndex + 1).some((precedingRunner) => trailingRunner.destinationRank > precedingRunner.destinationRank)
  );
}

function canChooseBatterDestination(result: string, destination: RunnerDestination) {
  const exactDestinations: Record<string, RunnerDestination> = {
    single: 'first',
    double: 'second',
    triple: 'third',
    home_run: 'home',
    walk: 'first',
    intentional_walk: 'first',
    hit_by_pitch: 'first',
    interference: 'first',
    ground_out: 'out',
    fly_out: 'out',
    line_out: 'out',
    sacrifice_bunt: 'out',
    sacrifice_fly: 'out',
    double_play: 'out',
    triple_play: 'out'
  };
  const expected = exactDestinations[result];
  if (expected) return destination === expected;
  if (result === 'strikeout') return destination === 'out' || destination === 'first';
  if (result === 'dropped_third_strike') return destination !== 'stay';
  return ['reached_on_error', 'fielders_choice', 'interference'].includes(result) && destination !== 'stay';
}

function buildPendingPayload(snapshot: DiamondScorebookSnapshot, pending: PendingPlay, controlMode: DiamondCaptureMode): DiamondJsonObject {
  if (pending.type !== 'record_plate_appearance') return parseEditableProposalPayload(pending);
  const batterId = pending.batterId || snapshot.currentBatter?.playerId;
  const pitcherId = pending.pitcherId || snapshot.currentPitcher?.playerId;
  if (!batterId || !pitcherId) throw new Error('Set the current batter and pitcher before recording a plate appearance.');
  const batterMove = pending.runnerMoves.find((move) => move.from === 'batter');
  if (!batterMove) throw new Error('Review the batter destination before recording this play.');
  const fielding: DiamondJsonObject = {};
  if (pending.putoutBy) fielding.putoutBy = pending.putoutBy;
  if (pending.assistBy) fielding.assists = [pending.assistBy];
  if (pending.errorBy) fielding.errors = [{ playerId: pending.errorBy, kind: 'fielding' }];
  if (pending.battedBall !== 'unknown') fielding.battedBall = pending.battedBall;
  const hasFielding = Object.keys(fielding).length > 0;
  const scoredMoves = pending.runnerMoves.filter((move) => move.to === 'home' && move.countsRun !== false);
  return {
    batterId,
    pitcherId,
    result: pending.result,
    batterAdvance: {
      to: batterMove.to,
      cause: batterMove.cause,
      ...(batterMove.to === 'home'
        ? {
            countsRun: batterMove.countsRun,
            rbi: reviewedMoveHasRbi(pending.result, batterMove),
            ...(batterMove.responsiblePitcherId ? { responsiblePitcherId: batterMove.responsiblePitcherId } : {}),
            ...(typeof batterMove.earned === 'boolean' ? { earned: batterMove.earned } : {})
          }
        : {}),
      ...(batterMove.to === 'out' ? { outKind: batterMove.outKind } : {})
    },
    runnerAdvances: pending.runnerMoves
      .filter((move) => move.from !== 'batter')
      .map((move) => ({
        runnerId: move.playerId,
        from: move.from,
        to: move.to,
        cause: move.cause,
        ...(move.to === 'home'
          ? {
              countsRun: move.countsRun,
              rbi: reviewedMoveHasRbi(pending.result, move),
              ...(move.responsiblePitcherId ? { responsiblePitcherId: move.responsiblePitcherId } : {}),
              ...(typeof move.earned === 'boolean' ? { earned: move.earned } : {})
            }
          : {}),
        ...(move.to === 'out' ? { outKind: move.outKind } : {})
      })),
    outsOnPlay: pending.outsOnPlay,
    runsBattedIn: Math.min(
      pending.runnerMoves.filter((move) => move.to === 'home' && reviewedMoveHasRbi(pending.result, move)).length,
      scoredMoves.length
    ),
    ...(hasFielding ? { fielding } : {}),
    ...(snapshot.captureMode === 'quick' || controlMode === 'quick' ? { omissions: ['fielding', 'situational', 'pitches'] } : {})
  };
}

export function DiamondScorebook({
  auth,
  teamId: teamIdProp,
  gameId: gameIdProp,
  initialSnapshot = null,
  client = diamondScorebookClient,
  aiDependencies
}: DiamondScorebookProps) {
  const params = useParams();
  const teamId = decodeURIComponent(teamIdProp || params.teamId || '');
  const gameId = decodeURIComponent(gameIdProp || params.gameId || params.eventId || '');
  const initialQueueIdentity = getQueueIdentity(initialSnapshot, auth.user?.uid);
  const [snapshot, setSnapshot] = useState<DiamondScorebookSnapshot | null>(initialSnapshot);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [busy, setBusy] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [queueCount, setQueueCount] = useState(() => (initialQueueIdentity ? client.readQueue(initialQueueIdentity).length : 0));
  const [controlMode, setControlMode] = useState<DiamondCaptureMode>(initialSnapshot?.captureMode || 'quick');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingPlay, setPendingPlay] = useState<PendingPlay | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState('');
  const [voiceIntent, setVoiceIntent] = useState<'play' | 'private-note'>('play');
  const [dictating, setDictating] = useState(false);
  const [interpreting, setInterpreting] = useState(false);
  const [voiceQuestions, setVoiceQuestions] = useState<string[]>([]);
  const [voiceConfidence, setVoiceConfidence] = useState<number | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [attachNoteToLastPlay, setAttachNoteToLastPlay] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffCandidates, setHandoffCandidates] = useState<DiamondHandoffCandidateState | null>(null);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handoffTarget, setHandoffTarget] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [recapState, setRecapState] = useState<DiamondAiDraftState | null>(null);
  const [generatingRecap, setGeneratingRecap] = useState(false);
  const [publishingRecap, setPublishingRecap] = useState(false);
  const [publishRecapOpen, setPublishRecapOpen] = useState(false);
  const [lineupDrafts, setLineupDrafts] = useState<LineupDrafts>(() => copyLineupDrafts(initialSnapshot));
  const [lineupDirty, setLineupDirty] = useState<Record<DiamondSide, boolean>>({ home: false, away: false });
  const [defenseDrafts, setDefenseDrafts] = useState<DefenseDrafts>(() => copyDefenseDrafts(initialSnapshot));
  const [defenseDirty, setDefenseDirty] = useState<Record<DiamondSide, boolean>>({ home: false, away: false });
  const [activeDefenseDrafts, setActiveDefenseDrafts] = useState<ActiveDefenseDrafts>(() =>
    activeDefenseDraftsForSnapshot(initialSnapshot)
  );
  const [privateHistory, setPrivateHistory] = useState<DiamondPrivateHistoryWindow | null>(null);
  const [loadingPrivateHistory, setLoadingPrivateHistory] = useState(false);
  const [loadingOlderPrivateHistory, setLoadingOlderPrivateHistory] = useState(false);
  const [eventCorrectionReason, setEventCorrectionReason] = useState('');
  const [correctionSearch, setCorrectionSearch] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const stopNativeDictationRef = useRef<(() => Promise<void>) | null>(null);
  const reconcileKeyRef = useRef('');
  const snapshotRef = useRef<DiamondScorebookSnapshot | null>(initialSnapshot);
  const queueCountRef = useRef(queueCount);
  const authenticatedUidRef = useRef(auth.user?.uid || null);
  const confirmingPendingRef = useRef(false);
  const placingTiebreakerRef = useRef(false);
  const appBuildRef = useRef<number | null>(null);
  const appBuildPromiseRef = useRef<Promise<number> | null>(null);
  const handoffRequestGenerationRef = useRef(0);

  snapshotRef.current = snapshot;
  queueCountRef.current = queueCount;
  authenticatedUidRef.current = auth.user?.uid || null;

  const expireHandoffCandidates = useCallback((closePanel = true) => {
    handoffRequestGenerationRef.current += 1;
    setHandoffCandidates(null);
    setHandoffLoading(false);
    setHandoffError(null);
    setHandoffTarget('');
    if (closePanel) setHandoffOpen(false);
    setConfirmation((current) => (current?.kind === 'handoff' ? null : current));
  }, []);

  const backTarget = teamId && gameId ? `/schedule/${encodeURIComponent(teamId)}/${encodeURIComponent(gameId)}?section=game` : '/schedule';

  const refreshSnapshot = useCallback(
    async (showLoading = false) => {
      expireHandoffCandidates();
      if (!auth.user || !teamId || !gameId) {
        setLoading(false);
        setNotice({ tone: 'error', message: 'Sign in and open a scheduled game before using Diamond Scorebook.' });
        return null;
      }
      if (showLoading) setLoading(true);
      try {
        const next = await client.load(teamId, gameId);
        const previousInstanceId = snapshotRef.current?.instanceId || null;
        setSnapshot(next);
        if (!previousInstanceId || previousInstanceId !== next.instanceId) {
          setControlMode(next.captureMode);
        }
        const nextQueueIdentity = getQueueIdentity(next, auth.user.uid);
        setQueueCount(nextQueueIdentity ? client.readQueue(nextQueueIdentity).length : 0);
        setNotice(null);
        return next;
      } catch (error) {
        setNotice({ tone: 'error', message: describeError(error, 'Unable to load the diamond scorebook.') });
        return null;
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [auth.user, client, expireHandoffCandidates, gameId, teamId]
  );

  useEffect(() => {
    expireHandoffCandidates();
    if (initialSnapshot) {
      setSnapshot(initialSnapshot);
      setControlMode(initialSnapshot.captureMode);
      setLoading(false);
      return;
    }
    void refreshSnapshot(true);
  }, [expireHandoffCandidates, initialSnapshot, refreshSnapshot]);

  useEffect(() => {
    expireHandoffCandidates();
  }, [
    auth.user?.uid,
    expireHandoffCandidates,
    gameId,
    snapshot?.instanceId,
    snapshot?.lease.holderUid,
    snapshot?.lease.leaseId,
    snapshot?.revision,
    teamId
  ]);

  useEffect(
    () => () => {
      handoffRequestGenerationRef.current += 1;
    },
    []
  );

  useEffect(() => {
    if (!snapshot) return;
    setLineupDrafts((current) => ({
      home: lineupDirty.home ? current.home : snapshot.lineups.home.map((entry) => ({ ...entry })),
      away: lineupDirty.away ? current.away : snapshot.lineups.away.map((entry) => ({ ...entry }))
    }));
  }, [lineupDirty.away, lineupDirty.home, snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const next = copyDefenseDrafts(snapshot);
    setDefenseDrafts((current) => ({
      home: defenseDirty.home ? current.home : next.home,
      away: defenseDirty.away ? current.away : next.away
    }));
  }, [defenseDirty.away, defenseDirty.home, snapshot]);

  useEffect(() => {
    setActiveDefenseDrafts((current) => {
      if (!snapshot || snapshot.lifecycle !== 'active') {
        return current.home || current.away ? { home: null, away: null } : current;
      }
      const home =
        current.home && activeDefenseDraftMatchesSnapshot(current.home, snapshot, 'home')
          ? current.home
          : activeDefenseDraftForSnapshot(snapshot, 'home');
      const away =
        current.away && activeDefenseDraftMatchesSnapshot(current.away, snapshot, 'away')
          ? current.away
          : activeDefenseDraftForSnapshot(snapshot, 'away');
      return home === current.home && away === current.away ? current : { home, away };
    });
  }, [snapshot]);

  useEffect(() => {
    const source = pendingPlay?.activeDefenseSource;
    if (!source || busy || confirmingPendingRef.current) return;
    if (queueCount === 0 && activeDefenseSourceMatchesSnapshot(snapshot, source, auth.user?.uid)) return;
    setPendingPlay(null);
    setNotice({
      tone: 'error',
      message:
        'This defensive alignment review expired because the revision or scoring lease changed, or another command entered the queue. Review the current defense again.'
    });
  }, [auth.user?.uid, busy, pendingPlay, queueCount, snapshot]);

  useEffect(() => {
    const source = pendingPlay?.substitutionSource;
    if (!source || busy || confirmingPendingRef.current) return;
    if (queueCount === 0 && substitutionSourceMatchesSnapshot(snapshot, source, auth.user?.uid)) return;
    setPendingPlay(null);
    setNotice({
      tone: 'error',
      message:
        'This substitution review expired because the revision or live base state changed, the scoring lease moved, or another command entered the queue. Review the current lineup again.'
    });
  }, [auth.user?.uid, busy, pendingPlay, queueCount, snapshot]);

  useEffect(() => {
    const source = pendingPlay?.plateAppearanceSource;
    if (!source || busy || confirmingPendingRef.current) return;
    if (queueCount === 0 && plateAppearanceSourceMatchesSnapshot(snapshot, source, auth.user?.uid)) return;
    setPendingPlay(null);
    setNotice({
      tone: 'error',
      message:
        'This plate-appearance review expired because the revision or base state changed, the scoring lease moved, or another command entered the queue. Review the current play again.'
    });
  }, [auth.user?.uid, busy, pendingPlay, queueCount, snapshot]);

  useEffect(() => {
    const source = pendingPlay?.runnerAdvanceSource;
    if (!source || busy || confirmingPendingRef.current) return;
    if (queueCount === 0 && runnerAdvanceSourceMatchesSnapshot(snapshot, source, auth.user?.uid)) return;
    setPendingPlay(null);
    setNotice({
      tone: 'error',
      message:
        'This runner review expired because the revision or base state changed, the scoring lease moved, or another command entered the queue. Review the current runner again.'
    });
  }, [auth.user?.uid, busy, pendingPlay, queueCount, snapshot]);

  useEffect(() => {
    setRecapState(null);
    setPublishRecapOpen(false);
    setPrivateHistory(null);
    setCorrectionSearch('');
  }, [gameId, teamId]);

  useEffect(() => {
    if (privateHistory && snapshot && privateHistory.sourceRevision !== snapshot.revision) setPrivateHistory(null);
  }, [privateHistory, snapshot]);

  useEffect(() => {
    appBuildRef.current = null;
    appBuildPromiseRef.current = null;
  }, [client]);

  useEffect(() => {
    const identity = getQueueIdentity(snapshot, auth.user?.uid);
    if (!identity) {
      setQueueCount(0);
      reconcileKeyRef.current = '';
      return;
    }
    setQueueCount(client.readQueue(identity).length);
  }, [auth.user?.uid, client, snapshot]);

  useEffect(() => {
    if (!recapState || recapState.stale) return;
    const remainsCurrent = Boolean(
      snapshot?.authoritative &&
      snapshot.lifecycle === 'final' &&
      snapshot.revision === recapState.source.sourceRevision &&
      snapshot.checkpointHash === recapState.source.checkpointHash
    );
    if (!remainsCurrent) {
      setRecapState((current) => (current ? { ...current, stale: true } : current));
      setPublishRecapOpen(false);
    }
  }, [recapState, snapshot]);

  useEffect(() => {
    const handleOnline = () => setNetworkOnline(true);
    const handleOffline = () => setNetworkOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      void stopNativeDictationRef.current?.().catch(() => {});
      stopNativeDictationRef.current = null;
    },
    []
  );

  const reconcileQueue = useCallback(async () => {
    if (!networkOnline || !teamId || !gameId || reconciling || queueCount === 0) return;
    const identity = getQueueIdentity(snapshotRef.current, auth.user?.uid);
    if (!identity) {
      setQueueCount(0);
      setNotice({
        tone: 'error',
        message: 'Queued plays are quarantined because the signed-in scorer, scoring lease, or Diamond game instance changed.'
      });
      return;
    }
    setReconciling(true);
    setNotice({
      tone: 'info',
      message: `Reconciling ${queueCount} queued ${queueCount === 1 ? 'play' : 'plays'} with the authoritative game.`
    });
    try {
      const result = await client.reconcileQueue(identity);
      setQueueCount(result.remaining.length);
      if (result.lastSnapshot) setSnapshot(result.lastSnapshot);
      const refreshed = await refreshSnapshot(false);
      if (refreshed) {
        setNotice({
          tone: 'success',
          message: `${result.accepted + result.duplicates} queued ${result.accepted + result.duplicates === 1 ? 'play is' : 'plays are'} confirmed at revision ${refreshed.revision}.`
        });
      }
    } catch (error) {
      const currentIdentity = getQueueIdentity(snapshotRef.current, auth.user?.uid);
      setQueueCount(currentIdentity ? client.readQueue(currentIdentity).length : 0);
      setNotice({ tone: 'error', message: describeError(error, 'Queued plays could not be reconciled. Refresh before continuing.') });
      if (error instanceof DiamondScorebookError && error.code === 'stale-revision') {
        await refreshSnapshot(false);
      }
    } finally {
      setReconciling(false);
    }
  }, [auth.user?.uid, client, gameId, networkOnline, queueCount, reconciling, refreshSnapshot, teamId]);

  useEffect(() => {
    if (!networkOnline || queueCount === 0) {
      if (queueCount === 0) reconcileKeyRef.current = '';
      return;
    }
    const identity = getQueueIdentity(snapshot, auth.user?.uid);
    if (!identity) return;
    const key = `${identity.teamId}:${identity.gameId}:${identity.instanceId}:${identity.authenticatedUid}:${identity.leaseId}:${queueCount}`;
    if (reconcileKeyRef.current === key) return;
    reconcileKeyRef.current = key;
    void reconcileQueue();
  }, [auth.user?.uid, networkOnline, queueCount, reconcileQueue, snapshot]);

  const applyOutcome = useCallback(
    async (outcome: DiamondCommandOutcome, successMessage: string) => {
      if (outcome.snapshot) {
        // Command responses are allowed to contain only the deterministic domain
        // state. Keep that revision visible, but pause scoring until a private
        // state read restores presentation, completeness, and lease evidence.
        setSnapshot((current) => ({
          ...outcome.snapshot!,
          teamName: current?.teamName || outcome.snapshot!.teamName,
          opponentName: current?.opponentName || outcome.snapshot!.opponentName,
          homeName: current?.homeName || outcome.snapshot!.homeName,
          awayName: current?.awayName || outcome.snapshot!.awayName,
          recentPlays: current?.recentPlays || outcome.snapshot!.recentPlays,
          lease: current?.lease || outcome.snapshot!.lease,
          availablePlayers: current?.availablePlayers || outcome.snapshot!.availablePlayers,
          managedSide: current?.managedSide ?? outcome.snapshot!.managedSide,
          ruleCapabilities: current?.ruleCapabilities || outcome.snapshot!.ruleCapabilities,
          authoritative: false
        }));
      } else {
        setSnapshot((current) => (current ? { ...current, revision: outcome.revision, authoritative: false } : current));
      }
      const refreshed = await refreshSnapshot(false);
      setNotice(
        refreshed
          ? { tone: 'success', message: `${successMessage} Authoritative revision ${refreshed.revision}.` }
          : { tone: 'error', message: `${successMessage} The state is reconciling; refresh before recording another play.` }
      );
      return Boolean(refreshed);
    },
    [refreshSnapshot]
  );

  const resolveAppBuildForMutation = useCallback(async () => {
    if (appBuildRef.current !== null) return appBuildRef.current;
    const pending = appBuildPromiseRef.current || client.resolveAppBuild();
    appBuildPromiseRef.current = pending;
    try {
      const appBuild = await pending;
      if (!Number.isSafeInteger(appBuild) || appBuild < 1) {
        throw new DiamondScorebookError(
          'invalid-input',
          'This app does not expose a valid build number. Diamond scoring remains read only until the app is updated or rebuilt.'
        );
      }
      appBuildRef.current = appBuild;
      return appBuild;
    } catch (error) {
      appBuildPromiseRef.current = null;
      throw error;
    }
  }, [client]);

  const buildCommand = useCallback(
    (type: DiamondCommandType, payload: DiamondJsonObject, appBuild: number) => {
      if (!snapshot) throw new Error('Load the authoritative scorebook before recording a play.');
      if (!snapshot.lease.canScore || !snapshot.lease.leaseId) {
        throw new DiamondScorebookError('conflict', 'Acquire the current scoring lease before recording a play.');
      }
      return client.createCommand({
        teamId,
        gameId,
        appBuild,
        expectedInstanceId: snapshot.instanceId,
        leaseId: snapshot.lease.leaseId,
        expectedRevision: snapshot.revision + queueCount,
        rulesProfileId: snapshot.rulesProfileId,
        rulesProfileVersion: snapshot.rulesProfileVersion,
        type,
        payload
      });
    },
    [client, gameId, queueCount, snapshot, teamId]
  );

  const submitCommand = useCallback(
    async (
      type: DiamondCommandType,
      payload: DiamondJsonObject,
      successMessage: string,
      options: { allowWhenFinal?: boolean; validateCurrentState?: () => boolean; staleMessage?: string } = {}
    ): Promise<CommandSubmissionResult> => {
      if (!snapshot || busy || reconciling) return false;
      if (!snapshot.lease.canScore) {
        setNotice({ tone: 'error', message: 'This scorebook is read only because another scorekeeper holds the scoring lease.' });
        return false;
      }
      const scoringIdentity = getQueueIdentity(snapshot, auth.user?.uid);
      if (!scoringIdentity) {
        setNotice({
          tone: 'error',
          message: 'Refresh after signing in as the scorer who currently owns this Diamond scorebook.'
        });
        return false;
      }
      if (snapshot.lifecycle === 'final' && !options.allowWhenFinal) {
        setNotice({ tone: 'error', message: 'This game is final. Reopen it for a confirmed correction before changing the scorebook.' });
        return false;
      }
      if (snapshot.lifecycle === 'cancelled') {
        setNotice({ tone: 'error', message: 'This game is cancelled. Its Diamond scorebook is permanently read only.' });
        return false;
      }
      let command: DiamondCommandEnvelope;
      try {
        const appBuild = await resolveAppBuildForMutation();
        const currentSnapshot = snapshotRef.current;
        const currentIdentity = getQueueIdentity(currentSnapshot, authenticatedUidRef.current);
        if (
          !currentSnapshot ||
          !currentIdentity ||
          currentIdentity.authenticatedUid !== scoringIdentity.authenticatedUid ||
          currentIdentity.scorerUid !== scoringIdentity.scorerUid ||
          currentIdentity.instanceId !== scoringIdentity.instanceId ||
          currentIdentity.leaseId !== scoringIdentity.leaseId ||
          currentSnapshot.revision !== snapshot.revision ||
          queueCountRef.current !== queueCount ||
          (options.validateCurrentState && !options.validateCurrentState())
        ) {
          throw new DiamondScorebookError(
            'conflict',
            options.staleMessage || 'The signed-in scorer, scoring lease, game instance, or revision changed while preparing this command.'
          );
        }
        command = buildCommand(type, payload, appBuild);
      } catch (error) {
        setNotice({ tone: 'error', message: describeError(error, 'This play could not be prepared safely.') });
        return false;
      }

      if (!networkOnline || queueCount > 0) {
        try {
          const queue = client.enqueue(command, scoringIdentity);
          setQueueCount(queue.length);
          setNotice({
            tone: 'info',
            message: `${successMessage} queued with command ${command.commandId.slice(0, 8)}. The displayed field remains revision ${snapshot.revision} until reconciliation.`
          });
          return 'queued';
        } catch (error) {
          setNotice({ tone: 'error', message: describeError(error, 'This play could not be retained offline.') });
          return false;
        }
      }

      setBusy(true);
      setNotice(null);
      try {
        const outcome = await client.submitCommand(command);
        const authoritative = await applyOutcome(outcome, successMessage);
        return authoritative ? 'accepted' : 'reconciling';
      } catch (error) {
        if (error instanceof DiamondScorebookError && error.retryable) {
          try {
            const queue = client.enqueue(command, scoringIdentity);
            setQueueCount(queue.length);
            setNotice({
              tone: 'info',
              message: `Confirmation was interrupted. The same command ID is queued for idempotent reconciliation; do not re-enter the play.`
            });
            return 'queued';
          } catch (queueError) {
            setNotice({
              tone: 'error',
              message: describeError(queueError, 'The interrupted play could not be retained safely. Refresh before continuing.')
            });
            return false;
          }
        }
        setNotice({ tone: 'error', message: describeError(error, 'The scorebook action was not accepted.') });
        if (error instanceof DiamondScorebookError && error.code === 'stale-revision') await refreshSnapshot(false);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [
      applyOutcome,
      auth.user?.uid,
      buildCommand,
      busy,
      client,
      networkOnline,
      queueCount,
      reconciling,
      refreshSnapshot,
      resolveAppBuildForMutation,
      snapshot
    ]
  );

  const changeScorerLease = useCallback(
    async (operation: 'acquire' | 'recover') => {
      const requestedSnapshot = snapshotRef.current;
      const requestedUid = authenticatedUidRef.current;
      if (!requestedSnapshot || !requestedUid || busy || reconciling) return;
      if (!networkOnline) {
        setNotice({ tone: 'error', message: 'Reconnect before acquiring the scoring lease.' });
        return;
      }
      if (!requestedSnapshot.authoritative || queueCountRef.current > 0 || requestedSnapshot.lifecycle === 'cancelled') {
        setNotice({
          tone: 'error',
          message: 'Refresh the authoritative scorebook and reconcile any queued plays before changing the scoring lease.'
        });
        return;
      }
      const operationAllowed = operation === 'recover' ? requestedSnapshot.lease.canRecover : requestedSnapshot.lease.canAcquire;
      if (!operationAllowed || requestedSnapshot.lease.canScore) {
        setNotice({ tone: 'error', message: 'The scoring lease is no longer available. Refresh before trying again.' });
        return;
      }

      setBusy(true);
      setNotice(null);
      try {
        const appBuild = await resolveAppBuildForMutation();
        const currentSnapshot = snapshotRef.current;
        const stillAllowed =
          operation === 'recover' ? currentSnapshot?.lease.canRecover === true : currentSnapshot?.lease.canAcquire === true;
        if (
          !currentSnapshot ||
          !currentSnapshot.authoritative ||
          !stillAllowed ||
          currentSnapshot.lease.canScore ||
          currentSnapshot.lifecycle === 'cancelled' ||
          currentSnapshot.instanceId !== requestedSnapshot.instanceId ||
          currentSnapshot.revision !== requestedSnapshot.revision ||
          authenticatedUidRef.current !== requestedUid ||
          queueCountRef.current !== 0
        ) {
          throw new DiamondScorebookError(
            'conflict',
            'The signed-in user, scorebook revision, or lease availability changed before acquisition.'
          );
        }
        const outcome = await client.acquireLease({
          teamId,
          gameId,
          appBuild,
          expectedInstanceId: currentSnapshot.instanceId,
          expectedRevision: currentSnapshot.revision,
          operation
        });
        const acquired = outcome.snapshot;
        if (
          !acquired.authoritative ||
          acquired.instanceId !== currentSnapshot.instanceId ||
          acquired.revision !== outcome.revision ||
          acquired.lease.holderUid !== requestedUid ||
          !acquired.lease.canScore ||
          !acquired.lease.leaseId
        ) {
          throw new DiamondScorebookError('invalid-response', 'The server did not return an authoritative lease owned by you.');
        }
        const acquiredIdentity = getQueueIdentity(acquired, requestedUid);
        setSnapshot(acquired);
        setControlMode(acquired.captureMode);
        setQueueCount(acquiredIdentity ? client.readQueue(acquiredIdentity).length : 0);
        reconcileKeyRef.current = '';
        setNotice({
          tone: 'success',
          message:
            operation === 'recover'
              ? `Scoring lease recovered at revision ${acquired.revision}. The expired lease can no longer submit plays.`
              : `You acquired the scoring lease at revision ${acquired.revision}.`
        });
      } catch (error) {
        let reconciled: DiamondScorebookSnapshot | null = null;
        if (error instanceof DiamondScorebookError && error.retryable) {
          reconciled = await refreshSnapshot(false);
        }
        if (
          reconciled?.authoritative &&
          reconciled.lease.canScore &&
          reconciled.lease.holderUid === requestedUid &&
          reconciled.lease.leaseId
        ) {
          setNotice({
            tone: 'success',
            message: `The response was interrupted, but your scoring lease is authoritative at revision ${reconciled.revision}.`
          });
        } else {
          setNotice({ tone: 'error', message: describeError(error, 'The scoring lease could not be confirmed.') });
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, client, gameId, networkOnline, reconciling, refreshSnapshot, resolveAppBuildForMutation, teamId]
  );

  const loadHandoffCandidates = useCallback(async () => {
    const requestedSnapshot = snapshotRef.current;
    const requestedUid = authenticatedUidRef.current;
    if (
      !requestedSnapshot ||
      !requestedUid ||
      !requestedSnapshot.authoritative ||
      !requestedSnapshot.lease.canScore ||
      requestedSnapshot.lease.holderUid !== requestedUid ||
      !requestedSnapshot.lease.leaseId ||
      requestedSnapshot.lifecycle === 'cancelled' ||
      queueCountRef.current > 0 ||
      busy ||
      reconciling ||
      !networkOnline
    ) {
      setNotice({
        tone: 'error',
        message: 'Refresh the authoritative scorebook and reconcile any queued plays before opening scorer handoff.'
      });
      return;
    }

    const requestGeneration = handoffRequestGenerationRef.current + 1;
    handoffRequestGenerationRef.current = requestGeneration;
    setHandoffOpen(true);
    setHandoffCandidates(null);
    setHandoffTarget('');
    setHandoffError(null);
    setHandoffLoading(true);
    try {
      const result = await client.listScorerCandidates({
        authenticatedUid: requestedUid,
        teamId,
        gameId,
        expectedInstanceId: requestedSnapshot.instanceId,
        expectedRevision: requestedSnapshot.revision,
        leaseId: requestedSnapshot.lease.leaseId
      });
      if (handoffRequestGenerationRef.current !== requestGeneration) return;
      const currentSnapshot = snapshotRef.current;
      const currentUid = authenticatedUidRef.current;
      if (
        !currentSnapshot ||
        currentUid !== requestedUid ||
        !currentSnapshot.authoritative ||
        !currentSnapshot.lease.canScore ||
        currentSnapshot.lease.holderUid !== requestedUid ||
        currentSnapshot.lease.leaseId !== requestedSnapshot.lease.leaseId ||
        currentSnapshot.instanceId !== requestedSnapshot.instanceId ||
        currentSnapshot.revision !== requestedSnapshot.revision ||
        result.complete !== true ||
        result.teamId !== teamId ||
        result.gameId !== gameId ||
        result.instanceId !== requestedSnapshot.instanceId ||
        result.revision !== requestedSnapshot.revision ||
        result.leaseId !== requestedSnapshot.lease.leaseId
      ) {
        expireHandoffCandidates();
        setNotice({ tone: 'error', message: 'The scorer list expired because the revision, lease, or signed-in user changed.' });
        return;
      }
      const candidates = result.candidates.filter((candidate) => candidate.playerId !== requestedUid);
      setHandoffCandidates({ authenticatedUid: requestedUid, result: { ...result, candidates } });
      setHandoffTarget(candidates[0]?.playerId || '');
    } catch (error) {
      if (handoffRequestGenerationRef.current !== requestGeneration) return;
      setHandoffError(describeError(error, 'Unable to load the complete scorer handoff list.'));
    } finally {
      if (handoffRequestGenerationRef.current === requestGeneration) setHandoffLoading(false);
    }
  }, [busy, client, expireHandoffCandidates, gameId, networkOnline, reconciling, teamId]);

  const recordPitch = async (result: string, label: string) => {
    const sourceSnapshot = snapshotRef.current;
    if (!sourceSnapshot?.currentBatter || !sourceSnapshot.currentPitcher) {
      setNotice({ tone: 'error', message: 'Set the current batter and pitcher before recording a pitch.' });
      return;
    }
    if (plateAppearanceRequiresResolution(sourceSnapshot)) {
      setNotice({ tone: 'error', message: 'Resolve the pending plate appearance before recording another pitch.' });
      return;
    }
    await submitCommand(
      'record_pitch',
      {
        batterId: sourceSnapshot.currentBatter.playerId,
        pitcherId: sourceSnapshot.currentPitcher.playerId,
        result
      },
      `${label} recorded.`,
      {
        validateCurrentState: () => {
          const current = snapshotRef.current;
          return Boolean(current && !plateAppearanceRequiresResolution(current));
        },
        staleMessage: 'Resolve the pending plate appearance before recording another pitch.'
      }
    );
  };

  const placeTiebreakerRunner = async () => {
    if (placingTiebreakerRef.current || !snapshot || !battingSide || !pinnedRulesProfile || !tiebreakerRunner || !tiebreakerPitcherId) {
      return;
    }
    placingTiebreakerRef.current = true;
    try {
      await submitCommand(
        'place_tiebreaker_runner',
        {
          side: battingSide,
          runnerId: tiebreakerRunner.playerId,
          base: pinnedRulesProfile.tiebreaker.runnerBase,
          chargedToPitcherId: tiebreakerPitcherId
        },
        'Tiebreaker runner placed.'
      );
    } finally {
      placingTiebreakerRef.current = false;
    }
  };

  const reviewPlateAppearance = (sourceSnapshot: DiamondScorebookSnapshot, option: OutcomeOption) => {
    const pending = bindPlateAppearanceReview(sourceSnapshot, buildPendingOutcome(sourceSnapshot, option), authenticatedUidRef.current);
    if (!pending || queueCountRef.current > 0) {
      setNotice({
        tone: 'error',
        message: 'Refresh the authoritative batter, pitcher, bases, and scoring lease before reviewing this play.'
      });
      return;
    }
    setPendingPlay(pending);
  };

  const bindSubstitutionReview = (sourceSnapshot: DiamondScorebookSnapshot, pending: PendingPlay) => {
    if (pending.type !== 'substitute' && pending.type !== 're_enter') return pending;
    if (queueCountRef.current > 0) return null;
    const source = buildSubstitutionReviewSource(sourceSnapshot, pending.type, pending.payload, authenticatedUidRef.current);
    return source ? { ...pending, sourceRevision: sourceSnapshot.revision, substitutionSource: source } : null;
  };

  const reviewStructuredCommand = (type: DiamondCommandType, label: string, payload: DiamondJsonObject) => {
    if (!snapshot) return;
    const runnerPending = bindRunnerAdvanceReview(snapshot, buildStructuredPending(type, label, payload), authenticatedUidRef.current);
    const pending = runnerPending && bindSubstitutionReview(snapshot, runnerPending);
    if (!pending) {
      setNotice({
        tone: 'error',
        message: 'Refresh the authoritative field, lineup, live bases, and scoring lease before reviewing this command.'
      });
      return;
    }
    setPendingPlay(pending);
  };

  const confirmPendingPlay = async () => {
    if (!snapshot || !pendingPlay || confirmingPendingRef.current) return;
    confirmingPendingRef.current = true;
    try {
      const activeDefenseSource = pendingPlay.activeDefenseSource;
      const plateAppearanceSource = pendingPlay.plateAppearanceSource;
      const runnerAdvanceSource = pendingPlay.runnerAdvanceSource;
      const substitutionSource = pendingPlay.substitutionSource;
      if (activeDefenseSource && (queueCount > 0 || !activeDefenseSourceMatchesSnapshot(snapshot, activeDefenseSource, auth.user?.uid))) {
        setPendingPlay(null);
        setNotice({
          tone: 'error',
          message:
            'This defensive alignment review expired because the revision or scoring lease changed, or another command entered the queue. Review the current defense again.'
        });
        return;
      }
      if (
        plateAppearanceSource &&
        (queueCount > 0 || !plateAppearanceSourceMatchesSnapshot(snapshot, plateAppearanceSource, auth.user?.uid))
      ) {
        setPendingPlay(null);
        setNotice({
          tone: 'error',
          message:
            'This plate-appearance review expired because the revision or base state changed, the scoring lease moved, or another command entered the queue. Review the current play again.'
        });
        return;
      }
      if (runnerAdvanceSource && (queueCount > 0 || !runnerAdvanceSourceMatchesSnapshot(snapshot, runnerAdvanceSource, auth.user?.uid))) {
        setPendingPlay(null);
        setNotice({
          tone: 'error',
          message:
            'This runner review expired because the revision or base state changed, the scoring lease moved, or another command entered the queue. Review the current runner again.'
        });
        return;
      }
      if (substitutionSource && (queueCount > 0 || !substitutionSourceMatchesSnapshot(snapshot, substitutionSource, auth.user?.uid))) {
        setPendingPlay(null);
        setNotice({
          tone: 'error',
          message:
            'This substitution review expired because the revision or live base state changed, the scoring lease moved, or another command entered the queue. Review the current lineup again.'
        });
        return;
      }
      if (
        pendingPlay.source === 'voice' &&
        (pendingPlay.sourceRevision !== snapshot.revision || !snapshot.authoritative || queueCount > 0)
      ) {
        setPendingPlay(null);
        setNotice({
          tone: 'error',
          message: 'This AI draft is stale because the scorebook revision changed. Interpret the play again from the current field state.'
        });
        return;
      }
      const substitutionValidationError = validateSubstitutionPendingReview(pendingPlay);
      if (substitutionValidationError) {
        setNotice({ tone: 'error', message: substitutionValidationError });
        return;
      }
      const validationError = validateRunnerReview(pendingPlay, snapshot);
      if (validationError) {
        setNotice({ tone: 'error', message: validationError });
        return;
      }
      if (!pendingPlay.ambiguityConfirmed) {
        setNotice({ tone: 'error', message: 'Verify every unresolved AI field before confirming this play.' });
        return;
      }
      const payload = buildPendingPayload(snapshot, pendingPlay, controlMode);
      if (activeDefenseSource) {
        const validationError = validateActiveDefensePayload(payload, activeDefenseSource);
        if (validationError) {
          setNotice({ tone: 'error', message: validationError });
          return;
        }
      }
      const submitted = pendingPlay.correction
        ? await submitCommand(
            'supersede_event',
            {
              targetEventId: pendingPlay.correction.targetEventId,
              reason: pendingPlay.correction.reason,
              replacement: { type: pendingPlay.type, payload }
            },
            `${pendingPlay.label} appended as a correction.`
          )
        : await submitCommand(pendingPlay.type, payload, `${pendingPlay.label} recorded.`, {
            ...(plateAppearanceSource
              ? {
                  validateCurrentState: () =>
                    queueCountRef.current === 0 &&
                    plateAppearanceSourceMatchesSnapshot(snapshotRef.current, plateAppearanceSource, authenticatedUidRef.current),
                  staleMessage:
                    'This plate-appearance review expired because the game instance, revision, field state (including bases), signed-in scorer, or scoring lease changed while preparing this command.'
                }
              : runnerAdvanceSource
                ? {
                    validateCurrentState: () =>
                      queueCountRef.current === 0 &&
                      runnerAdvanceSourceMatchesSnapshot(snapshotRef.current, runnerAdvanceSource, authenticatedUidRef.current),
                    staleMessage:
                      'This runner review expired because the game instance, revision, base state, signed-in scorer, or scoring lease changed while preparing this command.'
                  }
                : substitutionSource
                  ? {
                      validateCurrentState: () =>
                        queueCountRef.current === 0 &&
                        substitutionSourceMatchesSnapshot(snapshotRef.current, substitutionSource, authenticatedUidRef.current),
                      staleMessage:
                        'This substitution review expired because the revision, live base state, signed-in scorer, or scoring lease changed.'
                    }
                  : {})
          });
      if (submitted === 'queued' && activeDefenseSource) {
        setActiveDefenseDrafts((current) => ({
          ...current,
          [activeDefenseSource.side]: activeDefenseDraftForSnapshot(snapshot, activeDefenseSource.side)
        }));
      }
      if (
        !submitted &&
        plateAppearanceSource &&
        !plateAppearanceSourceMatchesSnapshot(snapshotRef.current, plateAppearanceSource, authenticatedUidRef.current)
      ) {
        setPendingPlay(null);
        setNotice({
          tone: 'error',
          message:
            'This plate-appearance review expired because the game instance, revision, field state (including bases), signed-in scorer, or scoring lease changed while preparing this command.'
        });
        return;
      }
      if (
        !submitted &&
        runnerAdvanceSource &&
        !runnerAdvanceSourceMatchesSnapshot(snapshotRef.current, runnerAdvanceSource, authenticatedUidRef.current)
      ) {
        setPendingPlay(null);
        setNotice({
          tone: 'error',
          message:
            'This runner review expired because the game instance, revision, base state, signed-in scorer, or scoring lease changed while preparing this command.'
        });
        return;
      }
      if (
        !submitted &&
        substitutionSource &&
        !substitutionSourceMatchesSnapshot(snapshotRef.current, substitutionSource, authenticatedUidRef.current)
      ) {
        setPendingPlay(null);
        setNotice({
          tone: 'error',
          message:
            'This substitution review expired because the revision or live base state changed, the scoring lease moved, or another command entered the queue. Review the current lineup again.'
        });
        return;
      }
      if (submitted) setPendingPlay(null);
    } catch (error) {
      setNotice({ tone: 'error', message: describeError(error, 'Review this play before submitting it.') });
    } finally {
      confirmingPendingRef.current = false;
    }
  };

  const handleConfirmation = async () => {
    if (!confirmation || !snapshot) return;
    if (confirmation.kind === 'void') {
      const submitted = await submitCommand(
        'void_event',
        {
          targetEventId: confirmation.eventId,
          reason: confirmation.reason
        },
        `Correction appended for ${confirmation.label}.`
      );
      if (submitted) {
        setEventCorrectionReason('');
        setConfirmation(null);
      }
      return;
    }
    if (confirmation.kind === 'rules-decision') {
      const decision = confirmation;
      const submitted = await submitCommand(
        'rules_decision',
        {
          code: decision.code,
          description: decision.description
        },
        `${decision.label} recorded.`
      );
      if (submitted === 'accepted' && decision.opensFinalization) {
        setConfirmation({ kind: 'finalize' });
      } else if (submitted) {
        setConfirmation(null);
      }
      return;
    }
    if (confirmation.kind === 'finalize') {
      const submitted = await submitCommand('finalize', { confirmed: true }, 'Final score confirmed.');
      if (submitted) setConfirmation(null);
      return;
    }
    if (confirmation.kind === 'reopen') {
      const submitted = await submitCommand('reopen_for_correction', { reason: confirmation.reason }, 'Correction session opened.', {
        allowWhenFinal: true
      });
      if (submitted) {
        setCorrectionReason('');
        setConfirmation(null);
      }
      return;
    }
    setBusy(true);
    try {
      const appBuild = await resolveAppBuildForMutation();
      const currentIdentity = getQueueIdentity(snapshotRef.current, authenticatedUidRef.current);
      const listedCandidates = handoffCandidates?.result;
      const selectedCandidate = listedCandidates?.candidates.find(
        (candidate) => candidate.playerId === confirmation.toUid && candidate.name === confirmation.toName
      );
      if (
        !currentIdentity ||
        currentIdentity.authenticatedUid !== auth.user?.uid ||
        currentIdentity.scorerUid !== snapshot.lease.holderUid ||
        currentIdentity.instanceId !== snapshot.instanceId ||
        currentIdentity.leaseId !== snapshot.lease.leaseId ||
        snapshotRef.current?.revision !== snapshot.revision ||
        handoffCandidates?.authenticatedUid !== auth.user?.uid ||
        listedCandidates?.complete !== true ||
        listedCandidates.teamId !== teamId ||
        listedCandidates.gameId !== gameId ||
        listedCandidates.instanceId !== snapshot.instanceId ||
        listedCandidates.revision !== snapshot.revision ||
        listedCandidates.leaseId !== snapshot.lease.leaseId ||
        !selectedCandidate
      ) {
        throw new DiamondScorebookError('conflict', 'The scoring lease or Diamond game instance changed before handoff confirmation.');
      }
      const outcome = await client.requestHandoff({
        teamId,
        gameId,
        appBuild,
        expectedInstanceId: snapshot.instanceId,
        leaseId: snapshot.lease.leaseId,
        expectedRevision: snapshot.revision,
        rulesProfileId: snapshot.rulesProfileId,
        rulesProfileVersion: snapshot.rulesProfileVersion,
        toUid: confirmation.toUid
      });
      await applyOutcome(outcome, `Scorebook handed to ${confirmation.toName}.`);
      setConfirmation(null);
    } catch (error) {
      setNotice({ tone: 'error', message: describeError(error, 'The scorebook handoff was not confirmed.') });
    } finally {
      expireHandoffCandidates();
      setBusy(false);
    }
  };

  const finishDictation = () => {
    setDictating(false);
    recognitionRef.current = null;
    stopNativeDictationRef.current = null;
  };

  const addTranscript = (transcript: string) => {
    setVoiceDraft((current) => appendDictationTranscript(current, transcript));
    setVoiceQuestions([]);
    setVoiceConfidence(null);
    setNotice({ tone: 'success', message: 'Dictation added as editable text. Audio was not saved.' });
  };

  const startWebDictation = () => {
    const Recognition = getSpeechRecognitionConstructor(typeof window === 'undefined' ? null : window);
    if (!Recognition) {
      setNotice({ tone: 'info', message: 'Speech recognition is unavailable here. Use the keyboard microphone or type the play.' });
      return;
    }
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
    recognition.onresult = (event) => {
      const transcript = collectFinalDictationTranscript(event);
      if (transcript) addTranscript(transcript);
    };
    recognition.onerror = (event) => {
      setNotice({ tone: 'error', message: getDictationErrorMessage(event) });
      finishDictation();
    };
    recognition.onend = finishDictation;
    recognitionRef.current = recognition;
    setDictating(true);
    setNotice({ tone: 'info', message: 'Listening… speak the play, then pause.' });
    try {
      recognition.start();
    } catch (error) {
      finishDictation();
      setNotice({ tone: 'error', message: describeError(error, 'Dictation could not start.') });
    }
  };

  const toggleDictation = async () => {
    if (dictating) {
      await stopNativeDictationRef.current?.().catch(() => {});
      try {
        recognitionRef.current?.stop();
      } catch {
        recognitionRef.current?.abort();
      }
      finishDictation();
      return;
    }
    if (isCapacitorNativeRuntime(typeof window === 'undefined' ? null : window)) {
      setDictating(true);
      setNotice({ tone: 'info', message: 'Listening… speak the play, then pause.' });
      try {
        const session = await startNativeSpeechDictation({
          language: typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US',
          onTranscript: addTranscript,
          onError: (message) => setNotice({ tone: 'error', message }),
          onEnd: finishDictation
        });
        stopNativeDictationRef.current = session.stop;
      } catch (error) {
        finishDictation();
        setNotice({ tone: 'error', message: describeError(error, 'Dictation could not start.') });
      }
      return;
    }
    startWebDictation();
  };

  const interpretVoice = async () => {
    if (!snapshot || !voiceDraft.trim() || interpreting || !networkOnline) return;
    if (!snapshot.authoritative || !snapshot.lease.canScore || snapshot.lifecycle !== 'active' || queueCount > 0) {
      setNotice({
        tone: 'error',
        message: 'Refresh the authoritative game and resolve queued commands before interpreting a dictated play.'
      });
      return;
    }
    const requestSnapshot = snapshot;
    const sourceRevision = requestSnapshot.revision;
    const transcript = voiceDraft;
    const proposalIsCurrent = () => {
      const current = snapshotRef.current;
      return Boolean(
        current &&
        current.authoritative &&
        current.lifecycle === 'active' &&
        current.lease.canScore &&
        current.revision === sourceRevision &&
        queueCountRef.current === 0
      );
    };
    const rejectStaleProposal = () => {
      setVoiceQuestions([]);
      setVoiceConfidence(null);
      setNotice({
        tone: 'error',
        message: `The scorebook advanced beyond revision ${sourceRevision}. Dictate or interpret the play again from the current field state.`
      });
    };
    const openProposalReview = (proposal: PendingVoiceProposal, fallback = false) => {
      if (!proposalIsCurrent() || proposal.sourceRevision !== sourceRevision) {
        rejectStaleProposal();
        return;
      }
      const candidate = buildPendingVoicePlay(requestSnapshot, proposal);
      const plateAppearancePending = bindPlateAppearanceReview(requestSnapshot, candidate, authenticatedUidRef.current);
      const runnerPending =
        plateAppearancePending && bindRunnerAdvanceReview(requestSnapshot, plateAppearancePending, authenticatedUidRef.current);
      const pending = runnerPending && bindSubstitutionReview(requestSnapshot, runnerPending);
      if (!pending) {
        setVoiceQuestions([]);
        setVoiceConfidence(null);
        setNotice({
          tone: 'error',
          message:
            candidate.type === 'substitute' || candidate.type === 're_enter'
              ? 'The proposed substitution does not match the authoritative lineup or live bases. Review the current field and try again.'
              : 'The proposed play does not match the authoritative batter, pitcher, bases, or scoring lease. Review the current field and try again.'
        });
        return;
      }
      setPendingPlay(pending);
      setVoiceDraft('');
      setVoiceQuestions([]);
      setVoiceConfidence(null);
      setVoiceOpen(false);
      setNotice({
        tone: 'info',
        message: fallback
          ? 'The AI model was unavailable, so the safe server parser prepared a draft. Review every field before confirming.'
          : 'AI prepared a draft only. Review every field before confirming.'
      });
    };
    setInterpreting(true);
    setNotice(null);
    setVoiceQuestions([]);
    setVoiceConfidence(null);
    try {
      const result = await interpretDiamondTranscript(transcript, buildDiamondAiCommandContext(requestSnapshot), aiDependencies);
      if (!proposalIsCurrent()) {
        rejectStaleProposal();
        return;
      }
      if (result.status === 'proposal' && result.proposal) {
        openProposalReview(result.proposal);
        return;
      }
      if (result.status === 'needs-clarification') {
        setVoiceQuestions(result.unresolvedQuestions);
        setVoiceConfidence(result.confidence);
        setNotice({ tone: 'info', message: result.message });
        return;
      }
      if (result.status !== 'unavailable') {
        setNotice({ tone: 'error', message: result.message });
        return;
      }

      const fallbackProposal = await client.parseVoice({
        teamId,
        gameId,
        expectedRevision: sourceRevision,
        rulesProfileId: requestSnapshot.rulesProfileId,
        rulesProfileVersion: requestSnapshot.rulesProfileVersion,
        transcript
      });
      if (!proposalIsCurrent()) {
        rejectStaleProposal();
        return;
      }
      if (fallbackProposal.confidence < minimumVoiceProposalConfidence || fallbackProposal.unresolvedFields.length) {
        setVoiceQuestions(
          fallbackProposal.unresolvedFields.length
            ? fallbackProposal.unresolvedFields
            : ['Add the missing players, runner advances, outs, or scoring judgment before trying again.']
        );
        setVoiceConfidence(fallbackProposal.confidence);
        setNotice({
          tone: 'info',
          message: 'The safe server parser still needs clarification. No scorebook command was created.'
        });
        return;
      }
      openProposalReview(normalizeServerVoiceProposal(fallbackProposal, sourceRevision), true);
    } catch (error) {
      setNotice({
        tone: 'error',
        message: `${describeError(error, 'The dictated play could not be interpreted.')} Ordinary scoring controls are still available.`
      });
    } finally {
      setInterpreting(false);
    }
  };

  const savePrivateNote = async () => {
    if (!snapshot || !voiceDraft.trim() || savingNote || !networkOnline) return;
    setSavingNote(true);
    setNotice(null);
    try {
      const appBuild = await resolveAppBuildForMutation();
      const currentIdentity = getQueueIdentity(snapshotRef.current, authenticatedUidRef.current);
      if (
        !currentIdentity ||
        currentIdentity.authenticatedUid !== auth.user?.uid ||
        currentIdentity.scorerUid !== snapshot.lease.holderUid ||
        currentIdentity.instanceId !== snapshot.instanceId ||
        currentIdentity.leaseId !== snapshot.lease.leaseId ||
        snapshotRef.current?.revision !== snapshot.revision
      ) {
        throw new DiamondScorebookError('conflict', 'The scoring lease or Diamond game instance changed before this note was saved.');
      }
      const outcome = await client.savePrivateNote({
        teamId,
        gameId,
        appBuild,
        expectedInstanceId: snapshot.instanceId,
        leaseId: snapshot.lease.leaseId,
        expectedRevision: snapshot.revision,
        rulesProfileId: snapshot.rulesProfileId,
        rulesProfileVersion: snapshot.rulesProfileVersion,
        text: voiceDraft,
        attachedEventId: attachNoteToLastPlay ? attachableHistory[attachableHistory.length - 1]?.sourceEventId || null : null
      });
      await applyOutcome(outcome, 'Private staff note saved.');
      setVoiceDraft('');
      setVoiceQuestions([]);
      setVoiceConfidence(null);
      setVoiceOpen(false);
      setAttachNoteToLastPlay(false);
    } catch (error) {
      setNotice({ tone: 'error', message: describeError(error, 'The private note was not saved.') });
    } finally {
      setSavingNote(false);
    }
  };

  const loadPrivateHistory = async (loadOlder = false) => {
    const requested = snapshotRef.current;
    const currentWindow = privateHistory;
    if (
      !requested ||
      loadingPrivateHistory ||
      loadingOlderPrivateHistory ||
      !networkOnline ||
      !requested.authoritative ||
      queueCountRef.current > 0 ||
      (loadOlder && (!currentWindow?.hasOlder || currentWindow.oldestSequence === null))
    ) {
      setNotice({ tone: 'error', message: 'Refresh online and reconcile queued plays before loading private history.' });
      return;
    }
    if (loadOlder) setLoadingOlderPrivateHistory(true);
    else setLoadingPrivateHistory(true);
    try {
      const history = await client.loadPrivateHistoryWindow({
        teamId,
        gameId,
        expectedRevision: requested.revision,
        ...(loadOlder && currentWindow?.oldestSequence ? { beforeSequence: currentWindow.oldestSequence } : {})
      });
      if (snapshotRef.current?.revision !== history.sourceRevision || !snapshotRef.current.authoritative) {
        throw new DiamondScorebookError('stale-revision', 'The scorebook changed while private history was loading.');
      }
      const combined = loadOlder && currentWindow ? mergeDiamondPrivateHistoryWindows(currentWindow, history) : history;
      setPrivateHistory(combined);
      setNotice({
        tone: 'success',
        message: combined.historyComplete
          ? `Complete private history loaded through revision ${combined.sourceRevision}.`
          : `Verified events ${combined.oldestSequence}–${combined.newestSequence} through current revision ${combined.sourceRevision}. Older history remains available.`
      });
    } catch (error) {
      if (!loadOlder) setPrivateHistory(null);
      setNotice({
        tone: 'error',
        message: describeError(
          error,
          loadOlder
            ? 'Older private history could not be loaded. The verified current window was preserved.'
            : 'The current private-history window could not be loaded completely.'
        )
      });
    } finally {
      if (loadOlder) setLoadingOlderPrivateHistory(false);
      else setLoadingPrivateHistory(false);
    }
  };

  const updateLineup = (side: DiamondSide, entries: DiamondLineupEntry[]) => {
    setLineupDrafts((current) => ({
      ...current,
      [side]: entries.map((entry, index) => ({ ...entry, slot: index + 1 }))
    }));
    setLineupDirty((current) => ({ ...current, [side]: true }));
  };

  const addManualLineupPlayer = (side: DiamondSide, nameValue: string, numberValue: string) => {
    const name = nameValue.replace(/\s+/g, ' ').trim();
    const number = numberValue.trim();
    if (!name || name.length > 100 || number.length > 12) {
      setNotice({ tone: 'error', message: 'Enter a player name up to 100 characters and an optional number up to 12 characters.' });
      return false;
    }
    if (lineupDrafts[side].length >= 25) {
      setNotice({ tone: 'error', message: 'A batting order can contain at most 25 players.' });
      return false;
    }
    try {
      const playerId = `manual:${client.createSecureId()}`;
      updateLineup(side, [
        ...lineupDrafts[side],
        { playerId, name, number: number || null, slot: lineupDrafts[side].length + 1, active: true, battingRole: 'regular' }
      ]);
      setNotice({ tone: 'info', message: `${name} added locally. Save the ${side} lineup to make this ID authoritative.` });
      return true;
    } catch (error) {
      setNotice({ tone: 'error', message: describeError(error, 'A secure manual player ID could not be created.') });
      return false;
    }
  };

  const saveLineup = async (side: DiamondSide) => {
    const entries = lineupDrafts[side];
    if (entries.length < 1 || entries.length > 25 || new Set(entries.map((entry) => entry.playerId)).size !== entries.length) {
      setNotice({ tone: 'error', message: 'Each lineup needs 1–25 unique players before it can be saved.' });
      return;
    }
    if (!networkOnline) {
      setNotice({ tone: 'error', message: 'Reconnect before saving a lineup so Start uses authoritative batting orders.' });
      return;
    }
    const submitted = await submitCommand(
      'set_lineup',
      {
        side,
        entries: entries.map((entry, index) => ({
          slot: index + 1,
          playerId: entry.playerId,
          displayName: entry.name,
          ...(entry.number ? { jerseyNumber: entry.number } : {}),
          starter: true,
          battingRole: normalizeInitialBattingRole(entry.battingRole, supportedInitialBattingRoles)
        }))
      },
      `${side === 'home' ? snapshot?.homeName || 'Home' : snapshot?.awayName || 'Away'} lineup saved.`
    );
    if (submitted) setLineupDirty((current) => ({ ...current, [side]: false }));
  };

  const updateDefense = (side: DiamondSide, position: DiamondDefensivePosition, playerId: string) => {
    setDefenseDrafts((current) => {
      const next = { ...current[side] };
      if (playerId) next[position] = playerId;
      else delete next[position];
      return { ...current, [side]: next };
    });
    setDefenseDirty((current) => ({ ...current, [side]: true }));
  };

  const saveDefense = async (side: DiamondSide) => {
    const assignments = Object.entries(defenseDrafts[side]).flatMap(([position, playerId]) =>
      playerId ? [{ position: position as DiamondDefensivePosition, playerId }] : []
    );
    if (!defenseDrafts[side].P) {
      setNotice({ tone: 'error', message: `Choose the ${side} starting pitcher before saving defense.` });
      return;
    }
    if (new Set(assignments.map((assignment) => assignment.playerId)).size !== assignments.length) {
      setNotice({ tone: 'error', message: 'A player may hold only one defensive position in the saved alignment.' });
      return;
    }
    if (!networkOnline) {
      setNotice({ tone: 'error', message: 'Reconnect before saving defense so the official pitcher is authoritative.' });
      return;
    }
    const submitted = await submitCommand(
      'set_defensive_alignment',
      { side, assignments },
      `${side === 'home' ? snapshot?.homeName || 'Home' : snapshot?.awayName || 'Away'} defense saved.`
    );
    if (submitted) setDefenseDirty((current) => ({ ...current, [side]: false }));
  };

  const swapActiveDefense = (side: DiamondSide, position: DiamondDefensivePosition, playerId: string) => {
    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot || !isOpenActiveHalf(currentSnapshot) || activeFieldingSide(currentSnapshot) !== side) return;
    setActiveDefenseDrafts((current) => {
      const draft = current[side];
      if (!draft || !activeDefenseDraftMatchesSnapshot(draft, currentSnapshot, side)) {
        return { ...current, [side]: activeDefenseDraftForSnapshot(currentSnapshot, side) };
      }
      const currentPlayerId = draft.assignments[position];
      const otherPosition = defensivePositions.find((candidate) => draft.assignments[candidate] === playerId);
      if (!currentPlayerId || !otherPosition || otherPosition === position) return current;
      const assignments = {
        ...draft.assignments,
        [position]: playerId,
        [otherPosition]: currentPlayerId
      };
      if (defensePersonnelFingerprint(assignments) !== draft.sourcePersonnelFingerprint) return current;
      return { ...current, [side]: { ...draft, assignments } };
    });
  };

  const reviewActiveDefense = (side: DiamondSide) => {
    if (!snapshot || !isOpenActiveHalf(snapshot) || activeFieldingSide(snapshot) !== side || queueCount > 0) {
      setNotice({ tone: 'error', message: 'Use the current open half with no queued commands before changing live defense.' });
      return;
    }
    const identity = getQueueIdentity(snapshot, auth.user?.uid);
    const draft = activeDefenseDrafts[side];
    if (!identity || !snapshot.authoritative || !draft || !activeDefenseDraftMatchesSnapshot(draft, snapshot, side)) {
      setNotice({
        tone: 'error',
        message: 'Refresh as the current scoring-lease owner before reviewing a defensive alignment change.'
      });
      return;
    }
    const assignments = canonicalDefenseAssignments(draft.assignments);
    const source: ActiveDefenseReviewSource = {
      side,
      sourceRevision: snapshot.revision,
      sourceInstanceId: snapshot.instanceId,
      sourceLeaseId: identity.leaseId,
      authenticatedUid: identity.authenticatedUid,
      sourceDefenseFingerprint: draft.sourceDefenseFingerprint,
      sourcePersonnelFingerprint: draft.sourcePersonnelFingerprint
    };
    const payload: DiamondJsonObject = { side, assignments };
    const validationError = validateActiveDefensePayload(payload, source);
    if (validationError) {
      setNotice({ tone: 'error', message: validationError });
      return;
    }
    setPendingPlay({
      ...buildStructuredPending(
        'set_defensive_alignment',
        `${side === 'home' ? snapshot.homeName : snapshot.awayName} defensive alignment`,
        payload
      ),
      sourceRevision: snapshot.revision,
      activeDefenseSource: source
    });
  };

  const recapSourceIsCurrent = (source: DiamondRecapSource) => {
    const current = snapshotRef.current;
    return Boolean(
      current?.authoritative &&
      current.lifecycle === 'final' &&
      current.lease.canScore &&
      current.revision === source.sourceRevision &&
      current.checkpointHash === source.checkpointHash &&
      queueCountRef.current === 0
    );
  };

  const markRecapStale = () => {
    setRecapState((current) => (current ? { ...current, stale: true } : current));
    setPublishRecapOpen(false);
  };

  const generateRecap = async () => {
    if (!snapshot || generatingRecap || publishingRecap) return;
    if (snapshot.lifecycle !== 'final' || !snapshot.authoritative || !snapshot.lease.canScore || queueCount > 0 || !networkOnline) {
      setNotice({
        tone: 'error',
        message: 'Use the current online final scorebook with no queued commands before generating a post-game draft.'
      });
      return;
    }
    const requestedRevision = snapshot.revision;
    const requestedCheckpointHash = snapshot.checkpointHash;
    setGeneratingRecap(true);
    setNotice(null);
    try {
      const source = await client.getRecapSource({ teamId, gameId, sourceRevision: requestedRevision });
      if (source.checkpointHash !== requestedCheckpointHash || !recapSourceIsCurrent(source)) {
        markRecapStale();
        setNotice({
          tone: 'error',
          message: `The final scorebook changed after revision ${requestedRevision}. Generate a new recap from the current final revision.`
        });
        return;
      }
      const result = await draftDiamondGameSummary(source.packet, aiDependencies);
      if (!recapSourceIsCurrent(source)) {
        markRecapStale();
        setNotice({
          tone: 'error',
          message: `The final scorebook changed while AI was drafting revision ${requestedRevision}. That draft was discarded.`
        });
        return;
      }
      if (result.status !== 'draft' || !result.draft) {
        setNotice({
          tone: result.status === 'insufficient-source' ? 'info' : 'error',
          message: `${result.message} Scorebook, reports, and correction controls remain available.`
        });
        return;
      }
      setRecapState({ source, draft: result.draft, stale: false, publication: null });
      setNotice({ tone: 'success', message: 'AI prepared an unpublished draft. Review every source before choosing publication.' });
    } catch (error) {
      const stale = error instanceof DiamondScorebookError && error.code === 'stale-revision';
      if (stale) {
        markRecapStale();
        await refreshSnapshot(false);
      }
      setNotice({
        tone: 'error',
        message: `${describeError(error, 'The AI recap source could not be prepared.')} Scorebook, reports, and correction controls remain available.`
      });
    } finally {
      setGeneratingRecap(false);
    }
  };

  const publishRecap = async () => {
    const pending = recapState;
    if (!pending || publishingRecap || pending.stale || pending.publication) return;
    if (!networkOnline || !recapSourceIsCurrent(pending.source)) {
      markRecapStale();
      setNotice({
        tone: 'error',
        message: 'The AI draft is stale or offline. Return to the current final revision and generate a new draft before publishing.'
      });
      return;
    }
    setPublishingRecap(true);
    setNotice(null);
    try {
      const evidence = await client.publishAiDraft({
        requestId: client.createSecureId(),
        teamId,
        gameId,
        sourceRevision: pending.source.sourceRevision,
        checkpointHash: pending.source.checkpointHash,
        draft: pending.draft
      });
      const remainedCurrent = recapSourceIsCurrent(pending.source);
      setRecapState((current) =>
        current?.source.sourceRevision === pending.source.sourceRevision && current.source.checkpointHash === pending.source.checkpointHash
          ? { ...current, publication: evidence, stale: !remainedCurrent }
          : current
      );
      setNotice(
        remainedCurrent
          ? { tone: 'success', message: `AI recap publication confirmed at revision ${evidence.sourceRevision}.` }
          : {
              tone: 'info',
              message: `Publication was confirmed at revision ${evidence.sourceRevision}, then the scorebook changed. The published recap is marked stale.`
            }
      );
    } catch (error) {
      const stale = error instanceof DiamondScorebookError && error.code === 'stale-revision';
      if (stale) {
        markRecapStale();
        await refreshSnapshot(false);
      }
      setNotice({
        tone: 'error',
        message: `${describeError(error, 'The AI recap was not published.')} Reports and correction controls remain available.`
      });
    } finally {
      setPublishingRecap(false);
      setPublishRecapOpen(false);
    }
  };

  const visibleOutcomes = outcomeOptions.filter((option) => controlMode === 'full' || !option.fullOnly);
  const effectiveHistory = useMemo(() => effectivePrivateEvents(privateHistory?.items || []), [privateHistory]);
  const correctedEventIds = useMemo(
    () =>
      new Set(
        (privateHistory?.items || []).flatMap((event) =>
          event.voidsEventId || event.supersedesEventId ? [event.voidsEventId || event.supersedesEventId || ''] : []
        )
      ),
    [privateHistory]
  );
  const correctionCandidates = useMemo(
    () =>
      (privateHistory?.items || []).filter((event) => !uncorrectableEventTypes.has(event.type) && !correctedEventIds.has(event.eventId)),
    [correctedEventIds, privateHistory]
  );
  const visibleCorrectionCandidates = useMemo(() => {
    const search = correctionSearch.replace(/\s+/g, ' ').trim().toLowerCase();
    const matches = search
      ? correctionCandidates.filter((event) => {
          const view: DiamondEffectivePrivateEvent = {
            ...event,
            sourceEventId: event.eventId,
            effectiveType: event.type,
            effectivePayload: event.payload,
            corrected: false
          };
          const searchable = [
            event.eventId,
            `revision ${event.revision}`,
            event.type.replace(/_/g, ' '),
            privateEventLabel(view),
            readString(event.payload.result).replace(/_/g, ' '),
            readString(event.payload.batterId),
            readString(event.payload.runnerId),
            readString(event.payload.playEventId)
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return searchable.includes(search);
        })
      : correctionCandidates;
    return matches.slice(-50).reverse();
  }, [correctionCandidates, correctionSearch]);
  const attachableHistory = effectiveHistory.filter(
    (event) => event.effectiveType === 'record_plate_appearance' || event.effectiveType === 'advance_runner'
  );
  const privateNotes = effectiveHistory.filter((event) => event.effectiveType === 'private_note');
  const otherScorers = useMemo(() => {
    const result = handoffCandidates?.result;
    if (
      !snapshot ||
      !result ||
      result.complete !== true ||
      handoffCandidates.authenticatedUid !== auth.user?.uid ||
      snapshot.lease.holderUid !== auth.user?.uid ||
      result.teamId !== teamId ||
      result.gameId !== gameId ||
      result.instanceId !== snapshot.instanceId ||
      result.revision !== snapshot.revision ||
      result.leaseId !== snapshot.lease.leaseId
    ) {
      return [];
    }
    return result.candidates.filter((scorer) => scorer.playerId !== snapshot.lease.holderUid);
  }, [auth.user?.uid, gameId, handoffCandidates, snapshot, teamId]);
  const leaseAction: 'acquire' | 'recover' | null =
    snapshot && !snapshot.lease.canScore && snapshot.lifecycle !== 'cancelled'
      ? snapshot.lease.status === 'expired' && snapshot.lease.canRecover
        ? 'recover'
        : snapshot.lease.canAcquire
          ? 'acquire'
          : snapshot.lease.canRecover
            ? 'recover'
            : null
      : null;
  const pinnedRulesProfile = useMemo(() => resolvePinnedRulesProfile(snapshot), [snapshot]);
  const supportedInitialBattingRoles = useMemo(
    () => initialLineupBattingRoles(pinnedRulesProfile, snapshot?.ruleCapabilities.dpFlex === true),
    [pinnedRulesProfile, snapshot?.ruleCapabilities.dpFlex]
  );
  const mutationDisabled = Boolean(
    !snapshot ||
    busy ||
    reconciling ||
    !snapshot.lease.canScore ||
    !snapshot.authoritative ||
    queueCount > 0 ||
    snapshot.lifecycle === 'cancelled'
  );
  const battingSide: DiamondSide | null = snapshot ? (snapshot.inning.half === 'top' ? 'away' : 'home') : null;
  const liveDefenseSide: DiamondSide | null = snapshot && isOpenActiveHalf(snapshot) ? activeFieldingSide(snapshot) : null;
  const liveDefenseDraft = liveDefenseSide ? activeDefenseDrafts[liveDefenseSide] : null;
  const liveDefenseDirty = Boolean(
    liveDefenseDraft && defenseFingerprint(liveDefenseDraft.assignments) !== liveDefenseDraft.sourceDefenseFingerprint
  );
  const liveDefenseDisabled = Boolean(mutationDisabled || !getQueueIdentity(snapshot, auth.user?.uid));
  const tiebreakerPristineContext = Boolean(
    snapshot &&
    battingSide &&
    snapshot.authoritative &&
    isOpenActiveHalf(snapshot) &&
    pinnedRulesProfile?.tiebreaker.enabled &&
    snapshot.inning.number >= pinnedRulesProfile.tiebreaker.startInning &&
    snapshot.inning.outs === 0 &&
    snapshot.inning.balls === 0 &&
    snapshot.inning.strikes === 0 &&
    snapshot.inning.pitchesInPlateAppearance === 0 &&
    !snapshot.bases.first &&
    !snapshot.bases.second &&
    !snapshot.bases.third
  );
  const currentHalfRunsKnown = Number.isSafeInteger(snapshot?.currentHalfRuns) && Number(snapshot?.currentHalfRuns) >= 0;
  const tiebreakerPending = tiebreakerPristineContext && currentHalfRunsKnown && snapshot?.currentHalfRuns === 0;
  const tiebreakerEvidenceUnknown = tiebreakerPristineContext && !currentHalfRunsKnown;
  const tiebreakerRunner =
    snapshot && battingSide && snapshot.lineups[battingSide].length
      ? snapshot.lineups[battingSide][
          (snapshot.nextBatterSlot[battingSide] - 1 + snapshot.lineups[battingSide].length) % snapshot.lineups[battingSide].length
        ] || null
      : null;
  const currentPitcherId = snapshot?.currentPitcher?.playerId || null;
  const tiebreakerPitcherId =
    snapshot && liveDefenseSide && currentPitcherId === snapshot.defense[liveDefenseSide].P?.playerId ? currentPitcherId : null;
  const playControlsDisabled = mutationDisabled || snapshot?.lifecycle !== 'active' || tiebreakerPending || tiebreakerEvidenceUnknown;
  const pitchControlsDisabled = playControlsDisabled || Boolean(snapshot && plateAppearanceRequiresResolution(snapshot));
  const correctionControlsDisabled = mutationDisabled || !snapshot || !['active', 'correction'].includes(snapshot.lifecycle);
  const privateNoteDisabled = mutationDisabled || snapshot?.lifecycle === 'configured';
  const lineupsReady = Boolean(snapshot?.lineups.home.length && snapshot.lineups.away.length);
  const defensesReady = Boolean(snapshot?.defense.home.P && snapshot.defense.away.P);
  const finalizationCanBeReviewed = Boolean(
    snapshot &&
    (['active', 'correction'].includes(snapshot.lifecycle) ||
      (['ready', 'suspended'].includes(snapshot.lifecycle) && snapshot.gameEndDecision))
  );

  useEffect(() => {
    if (!handoffTarget && otherScorers.length) setHandoffTarget(otherScorers[0]!.playerId);
  }, [handoffTarget, otherScorers]);

  if (loading && !snapshot) {
    return (
      <section className="app-card flex min-h-64 items-center justify-center p-6 text-center" aria-live="polite">
        <div>
          <Loader2 className="text-primary-600 mx-auto h-8 w-8 animate-spin" aria-hidden="true" />
          <div className="mt-3 text-sm font-black text-gray-950">Loading authoritative scorebook</div>
          <div className="mt-1 text-xs font-semibold text-gray-500">Confirming the game revision and scoring lease.</div>
        </div>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <div className="space-y-3">
        <Link to={backTarget} className="ghost-button min-h-10 px-3 text-xs">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Game
        </Link>
        <section className="app-card p-5 text-center" role="alert">
          <AlertCircle className="mx-auto h-8 w-8 text-rose-600" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-black text-gray-950">Scorebook unavailable</h1>
          <p className="mt-1 text-sm leading-6 font-semibold text-gray-600">
            {notice?.message || 'Open a configured Baseball or Fastpitch game to start scoring.'}
          </p>
          <button type="button" className="primary-button mx-auto mt-4" onClick={() => void refreshSnapshot(true)}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </button>
        </section>
      </div>
    );
  }

  const connection = reconciling
    ? {
        label: `Reconciling ${queueCount}`,
        detail: 'Controls pause until every queued command is confirmed.',
        tone: 'amber' as const,
        icon: RefreshCw
      }
    : !networkOnline
      ? {
          label: `Offline · ${queueCount} queued`,
          detail:
            queueCount > 0
              ? `One command is durably queued from revision ${snapshot.revision}. Reconnect before entering another play so runners and count cannot drift.`
              : `Showing authoritative revision ${snapshot.revision}. One command can be queued safely on this device.`,
          tone: 'amber' as const,
          icon: CloudOff
        }
      : !snapshot.authoritative
        ? {
            label: 'Reconciling state',
            detail: `Revision ${snapshot.revision} is known, but the complete field projection is not confirmed.`,
            tone: 'amber' as const,
            icon: RefreshCw
          }
        : snapshot.lifecycle === 'cancelled'
          ? {
              label: `Cancelled · revision ${snapshot.revision}`,
              detail: snapshot.readOnlyReason || 'This game was cancelled. Its scorebook remains available as a read-only audit record.',
              tone: 'gray' as const,
              icon: LockKeyhole
            }
          : !snapshot.lease.canScore || snapshot.lifecycle === 'final'
            ? {
                label: 'Read only',
                detail:
                  snapshot.readOnlyReason ||
                  (snapshot.lifecycle === 'final'
                    ? 'This game is final.'
                    : `${snapshot.lease.holderName || 'Another scorekeeper'} has the scorebook.`),
                tone: 'gray' as const,
                icon: LockKeyhole
              }
            : snapshot.lifecycle === 'suspended'
              ? {
                  label: `Suspended · revision ${snapshot.revision}`,
                  detail: 'Resume explicitly before recording another play.',
                  tone: 'amber' as const,
                  icon: LockKeyhole
                }
              : snapshot.lifecycle === 'configured' || snapshot.lifecycle === 'ready'
                ? {
                    label: `Ready · revision ${snapshot.revision}`,
                    detail:
                      snapshot.lifecycle === 'ready'
                        ? lineupsReady && defensesReady
                          ? 'Both lineups and starting pitchers are authoritative. Start when both teams are ready.'
                          : 'Save both batting orders and each starting pitcher before starting.'
                        : 'Complete both lineups and defensive alignments before starting the game.',
                    tone: 'gray' as const,
                    icon: ShieldCheck
                  }
                : snapshot.lifecycle === 'correction'
                  ? {
                      label: `Correction · revision ${snapshot.revision}`,
                      detail: 'Only append-only corrections and finalization are available.',
                      tone: 'amber' as const,
                      icon: RotateCcw
                    }
                  : {
                      label: `Live · revision ${snapshot.revision}`,
                      detail: 'This field, score, and count are authoritative.',
                      tone: 'green' as const,
                      icon: Wifi
                    };
  const ConnectionIcon = connection.icon;

  return (
    <div className="space-y-3 pb-8" data-testid="diamond-scorebook">
      <header
        className="app-card shadow-app-lg border-primary-900 from-primary-700 to-primary-900 overflow-hidden bg-gradient-to-r text-white"
        data-testid="diamond-scorebook-header"
      >
        <div className="border-primary-600 flex items-center justify-between gap-3 border-b px-3 py-2">
          <Link
            to={backTarget}
            className="text-primary-50 hover:bg-primary-800 inline-flex min-h-10 items-center gap-1 rounded-xl px-2 text-xs font-black focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Game
          </Link>
          <div className="min-w-0 text-center">
            <h1 className="text-primary-100 truncate text-xs font-black tracking-widest uppercase">Diamond Scorebook</h1>
            <div className="truncate text-sm font-black">
              {snapshot.teamName} vs {snapshot.opponentName}
            </div>
          </div>
          <button
            type="button"
            className="text-primary-50 hover:bg-primary-800 inline-flex h-10 w-10 items-center justify-center rounded-xl focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            aria-label="Refresh authoritative scorebook"
            disabled={busy || reconciling}
            onClick={() => void refreshSnapshot(false)}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4">
          <ScoreSide name={snapshot.awayName} score={snapshot.score.away} align="left" />
          <div className="text-center">
            <div className="border-primary-500 bg-primary-800 text-primary-100 rounded-full border px-3 py-1 text-[11px] font-black tracking-wider uppercase">
              {inningLabel(snapshot)}
            </div>
            <div className="text-primary-100 mt-2 text-xs font-bold">
              {snapshot.inning.outs} {snapshot.inning.outs === 1 ? 'out' : 'outs'}
            </div>
          </div>
          <ScoreSide name={snapshot.homeName} score={snapshot.score.home} align="right" />
        </div>

        <div className="bg-primary-700 grid grid-cols-2 gap-px">
          <div className="bg-primary-900 px-4 py-2 text-center">
            <div className="text-primary-200 text-[10px] font-black tracking-wider uppercase">Count</div>
            <div className="mt-0.5 text-lg font-black tabular-nums">
              {snapshot.inning.balls}–{snapshot.inning.strikes}
            </div>
          </div>
          <div className="bg-primary-900 px-4 py-2 text-center">
            <div className="text-primary-200 text-[10px] font-black tracking-wider uppercase">Rules</div>
            <div className="mt-0.5 truncate text-xs font-black">
              {snapshot.rulesProfileId} · v{snapshot.rulesProfileVersion}
            </div>
          </div>
        </div>
      </header>

      <section
        className={`rounded-2xl border p-3 ${connection.tone === 'green' ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : connection.tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-gray-200 bg-gray-50 text-gray-800'}`}
        aria-live="polite"
        data-testid="diamond-connection-state"
      >
        <div className="flex items-start gap-3">
          <ConnectionIcon className={`mt-0.5 h-5 w-5 flex-none ${reconciling ? 'animate-spin' : ''}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black">{connection.label}</div>
            <div className="mt-0.5 text-xs leading-5 font-semibold opacity-80">{connection.detail}</div>
          </div>
          {networkOnline && queueCount > 0 ? (
            <button
              type="button"
              className="ghost-button !min-h-9 !px-3 text-xs"
              onClick={() => void reconcileQueue()}
              disabled={reconciling}
            >
              Sync now
            </button>
          ) : null}
        </div>
      </section>

      {notice ? <NoticeCard notice={notice} /> : null}

      {snapshot.lifecycle === 'cancelled' ? (
        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-gray-800" aria-labelledby="diamond-cancelled-title">
          <div id="diamond-cancelled-title" className="text-sm font-black">
            Cancelled game · scorebook closed
          </div>
          <div className="mt-1 text-xs leading-5 font-semibold">
            Confirmed history stays visible for audit and replay, but no plays, notes, corrections, handoffs, or AI publication can be
            added. Team managers handle cancellation from the schedule—not from scorer controls.
          </div>
        </section>
      ) : null}

      {snapshot.lifecycle === 'ready' ? (
        <LineupSetup
          snapshot={snapshot}
          drafts={lineupDrafts}
          dirty={lineupDirty}
          defenseDrafts={defenseDrafts}
          defenseDirty={defenseDirty}
          disabled={mutationDisabled}
          online={networkOnline}
          onChange={updateLineup}
          onAddManual={addManualLineupPlayer}
          onSave={(side) => void saveLineup(side)}
          onDefenseChange={updateDefense}
          onDefenseSave={(side) => void saveDefense(side)}
          onStart={() => void submitCommand('start', {}, 'Game started.')}
          canStart={lineupsReady && defensesReady && !lineupDirty.home && !lineupDirty.away && !defenseDirty.home && !defenseDirty.away}
          battingRoles={supportedInitialBattingRoles}
        />
      ) : snapshot.lifecycle === 'suspended' ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
          <div className="text-sm font-black">Scoring is suspended</div>
          <div className="mt-1 text-xs leading-5 font-semibold">
            Resume explicitly after the delay; ordinary play controls remain locked.
          </div>
          <button
            type="button"
            className="primary-button mt-3 justify-center"
            disabled={mutationDisabled || !networkOnline}
            onClick={() => void submitCommand('resume', {}, 'Scoring resumed.')}
          >
            Resume game
          </button>
        </section>
      ) : snapshot.lifecycle === 'configured' ? (
        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-gray-800">
          <div className="text-sm font-black">Lineup setup required</div>
          <div className="mt-1 text-xs leading-5 font-semibold">
            Set both batting orders and the defensive alignment before starting. Existing game and tracker routes remain available.
          </div>
        </section>
      ) : null}

      {liveDefenseSide && liveDefenseDraft ? (
        <ActiveDefenseAlignmentEditor
          side={liveDefenseSide}
          name={liveDefenseSide === 'home' ? snapshot.homeName : snapshot.awayName}
          assignments={liveDefenseDraft.assignments}
          players={activeDefensePlayers(snapshot, liveDefenseSide)}
          dirty={liveDefenseDirty}
          disabled={liveDefenseDisabled}
          onSwap={(position, playerId) => swapActiveDefense(liveDefenseSide, position, playerId)}
          onReview={() => reviewActiveDefense(liveDefenseSide)}
        />
      ) : null}

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(17rem,0.8fr)]">
        <div className="space-y-3">
          <section className="app-card overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
              <PlayerContext label="At bat" player={snapshot.currentBatter} />
              <PlayerContext label="Pitching" player={snapshot.currentPitcher} />
            </div>
            <BaseDiamond snapshot={snapshot} />
          </section>

          {tiebreakerPending && battingSide && pinnedRulesProfile ? (
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4" aria-labelledby="diamond-tiebreaker-title">
              <h2 id="diamond-tiebreaker-title" className="text-sm font-black text-amber-950">
                Tiebreaker runner required
              </h2>
              <p className="mt-1 text-xs leading-5 font-semibold text-amber-900">
                {playerLabel(tiebreakerRunner)} is the previous scheduled batter and must begin on{' '}
                {pinnedRulesProfile.tiebreaker.runnerBase} before the first play of this half.
              </p>
              <button
                type="button"
                className="primary-button mt-3 w-full justify-center sm:w-auto"
                disabled={mutationDisabled || !tiebreakerRunner || !tiebreakerPitcherId}
                onClick={() => void placeTiebreakerRunner()}
              >
                Confirm tiebreaker runner
              </button>
            </section>
          ) : null}

          {tiebreakerEvidenceUnknown ? (
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4" role="alert">
              <h2 className="text-sm font-black text-amber-950">Tiebreaker state needs refresh</h2>
              <p className="mt-1 text-xs leading-5 font-semibold text-amber-900">
                Current-half run evidence is unavailable. Refresh the authoritative scorebook before placing a runner or recording a play.
              </p>
            </section>
          ) : null}

          <section className="app-card p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-gray-950">Record the play</h2>
                <p className="mt-0.5 text-xs font-semibold text-gray-500">
                  One confirmed command updates runners, outs, score, and stats together.
                </p>
              </div>
              <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1" aria-label="Scoring control detail">
                {(['quick', 'full'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`min-h-11 rounded-lg px-3 text-xs font-black capitalize ${controlMode === mode ? 'text-primary-700 bg-white shadow-sm' : 'text-gray-500'}`}
                    aria-pressed={controlMode === mode}
                    disabled={mode === 'quick' && snapshot.captureMode === 'full'}
                    onClick={() => setControlMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            {controlMode !== snapshot.captureMode ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                {controlMode === 'full'
                  ? 'Full controls are visible, but this game began in Quick capture; earlier uncollected detail remains explicitly partial.'
                  : 'Quick controls cannot satisfy this game’s Full capture contract.'}
              </div>
            ) : null}

            {controlMode === 'full' ? (
              <fieldset className="mt-4">
                <legend className="text-[11px] font-black tracking-wider text-gray-500 uppercase">Pitch</legend>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {pitchOptions.map((pitch) => (
                    <button
                      key={pitch.result}
                      type="button"
                      className="ghost-button min-h-12 justify-center !px-2 text-xs"
                      disabled={pitchControlsDisabled}
                      onClick={() => void recordPitch(pitch.result, pitch.label)}
                    >
                      {pitch.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <fieldset className="mt-4">
              <legend className="text-[11px] font-black tracking-wider text-gray-500 uppercase">Plate appearance</legend>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {visibleOutcomes.map((outcome) => (
                  <button
                    key={outcome.result}
                    type="button"
                    className={`focus-visible:ring-primary-500 min-h-14 rounded-xl border px-2 text-sm font-black transition focus-visible:ring-2 focus-visible:outline-none ${outcome.result === 'home_run' ? 'border-amber-300 bg-amber-50 text-amber-900' : outcome.outs ? 'border-gray-300 bg-gray-50 text-gray-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}
                    disabled={playControlsDisabled || (snapshot.inning.outs >= 2 && isSacrificeResult(outcome.result))}
                    onClick={() => reviewPlateAppearance(snapshot, outcome)}
                  >
                    {outcome.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="ghost-button min-h-12 justify-center text-xs"
                disabled={playControlsDisabled}
                onClick={() => {
                  setVoiceIntent('play');
                  setVoiceQuestions([]);
                  setVoiceConfidence(null);
                  setVoiceOpen(true);
                }}
              >
                <Mic className="h-4 w-4" aria-hidden="true" />
                Dictate play
              </button>
              <button
                type="button"
                className="ghost-button min-h-12 justify-center text-xs"
                disabled={privateNoteDisabled}
                onClick={() => {
                  setVoiceIntent('private-note');
                  setVoiceQuestions([]);
                  setVoiceConfidence(null);
                  setVoiceOpen(true);
                }}
              >
                <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                Private note
              </button>
            </div>

            {snapshot.inning.outs === 3 || snapshot.halfInningEnd ? (
              <button
                type="button"
                className="primary-button mt-3 w-full justify-center"
                disabled={playControlsDisabled}
                onClick={() =>
                  void submitCommand(
                    'advance_half_inning',
                    {},
                    snapshot.halfInningEnd ? 'Run-limited half inning advanced.' : 'Half inning advanced.'
                  )
                }
              >
                {snapshot.halfInningEnd ? 'Advance ended half inning' : 'Advance'} to{' '}
                {snapshot.inning.half === 'top' ? `bottom ${snapshot.inning.number}` : `top ${snapshot.inning.number + 1}`}
              </button>
            ) : null}

            {controlMode === 'full' ? (
              <AdvancedScoringPanel
                snapshot={snapshot}
                rulesProfile={pinnedRulesProfile}
                disabled={mutationDisabled}
                attachableEvents={attachableHistory}
                historyLoaded={privateHistory?.headComplete === true}
                historyLoading={loadingPrivateHistory || loadingOlderPrivateHistory}
                onLoadHistory={() => void loadPrivateHistory(false)}
                onReview={reviewStructuredCommand}
              />
            ) : null}
          </section>

          <section className="app-card p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-gray-950">Recent plays</h2>
                <p className="mt-0.5 text-xs font-semibold text-gray-500">
                  Corrections append history; they never erase a canonical event.
                </p>
              </div>
              <button
                type="button"
                className="ghost-button min-h-11 px-3 text-xs"
                disabled={
                  loadingPrivateHistory || loadingOlderPrivateHistory || !networkOnline || !snapshot.authoritative || queueCount > 0
                }
                onClick={() => void loadPrivateHistory(false)}
              >
                {loadingPrivateHistory ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                )}
                {privateHistory ? 'Refresh recent private history' : 'Load recent private history'}
              </button>
            </div>
            <ol className="mt-3 divide-y divide-gray-100" aria-label="Recent scorebook plays">
              {snapshot.recentPlays.length ? (
                [...snapshot.recentPlays].reverse().map((play) => (
                  <li key={play.eventId} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <div
                      className={`mt-1 h-2.5 w-2.5 flex-none rounded-full ${play.voided ? 'bg-gray-300' : 'bg-emerald-500'}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-bold ${play.voided ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                        {play.label}
                      </div>
                      <div className="mt-0.5 text-[11px] font-bold tracking-wide text-gray-500 uppercase">
                        {play.inningLabel} · rev {play.revision}
                        {play.voided ? ' · corrected' : ''}
                      </div>
                    </div>
                  </li>
                ))
              ) : (
                <li className="py-4 text-center text-sm font-semibold text-gray-500">No confirmed plays yet.</li>
              )}
            </ol>
            {privateHistory ? (
              <div className="mt-4 space-y-4 border-t border-gray-100 pt-4" data-testid="diamond-private-history">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-900">
                  {privateHistory.historyComplete
                    ? `Complete private history: ${privateHistory.items.length} canonical events through revision ${privateHistory.sourceRevision}.`
                    : `Verified private-history window: events ${privateHistory.oldestSequence}–${privateHistory.newestSequence} of ${privateHistory.sourceRevision}. Older events are not loaded yet.`}{' '}
                  The newest 20 notes and up to 50 matching correction candidates are rendered.
                </div>
                {privateHistory.hasOlder ? (
                  <button
                    type="button"
                    className="ghost-button min-h-11 w-full justify-center text-xs"
                    disabled={loadingPrivateHistory || loadingOlderPrivateHistory || !networkOnline || queueCount > 0}
                    onClick={() => void loadPrivateHistory(true)}
                  >
                    {loadingOlderPrivateHistory ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    )}
                    Load 200 older events
                  </button>
                ) : null}
                <section aria-labelledby="diamond-private-notes-title">
                  <h3 id="diamond-private-notes-title" className="text-xs font-black text-gray-900">
                    Staff-private notes
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {privateNotes.length ? (
                      privateNotes
                        .slice(-20)
                        .reverse()
                        .map((note) => (
                          <li key={note.sourceEventId} className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                            <div className="text-xs font-black text-violet-950">Revision {note.revision}</div>
                            <div className="mt-1 text-sm font-semibold whitespace-pre-wrap text-gray-800">
                              {readString(note.effectivePayload.text)}
                            </div>
                            {readString(note.effectivePayload.attachedEventId) ? (
                              <div className="mt-1 text-[11px] font-bold text-gray-500">
                                Attached to {readString(note.effectivePayload.attachedEventId)}
                              </div>
                            ) : null}
                          </li>
                        ))
                    ) : (
                      <li className="text-xs font-semibold text-gray-500">No effective staff-private notes.</li>
                    )}
                  </ul>
                </section>
                <section aria-labelledby="diamond-correction-events-title">
                  <h3 id="diamond-correction-events-title" className="text-xs font-black text-gray-900">
                    Append-only correction candidates
                  </h3>
                  <label className="mt-2 block text-[11px] font-black text-gray-700">
                    Search loaded correction candidates
                    <input
                      className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold"
                      value={correctionSearch}
                      maxLength={128}
                      placeholder="Event ID, revision, result, player, or command"
                      onChange={(event) => setCorrectionSearch(event.target.value)}
                    />
                  </label>
                  <label className="mt-2 block text-[11px] font-black text-gray-700">
                    Correction reason
                    <input
                      className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold"
                      value={eventCorrectionReason}
                      maxLength={300}
                      placeholder="Describe the official scoring correction"
                      onChange={(event) => setEventCorrectionReason(event.target.value)}
                    />
                  </label>
                  <ol className="mt-2 space-y-2">
                    {visibleCorrectionCandidates.length ? (
                      visibleCorrectionCandidates.map((event) => {
                        const view: DiamondEffectivePrivateEvent = {
                          ...event,
                          sourceEventId: event.eventId,
                          effectiveType: event.type,
                          effectivePayload: event.payload,
                          corrected: false
                        };
                        return (
                          <li key={event.eventId} className="rounded-xl border border-gray-200 p-3">
                            <div className="text-sm font-black text-gray-900">{privateEventLabel(view)}</div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                className="ghost-button min-h-11 justify-center text-xs"
                                disabled={correctionControlsDisabled || !eventCorrectionReason.trim()}
                                onClick={() =>
                                  setConfirmation({
                                    kind: 'void',
                                    eventId: event.eventId,
                                    label: privateEventLabel(view),
                                    reason: eventCorrectionReason.replace(/\s+/g, ' ').trim()
                                  })
                                }
                              >
                                Void effect
                              </button>
                              <button
                                type="button"
                                className="ghost-button min-h-11 justify-center text-xs"
                                disabled={
                                  correctionControlsDisabled || !eventCorrectionReason.trim() || event.type !== 'record_plate_appearance'
                                }
                                onClick={() => {
                                  try {
                                    setPendingPlay(
                                      buildPendingPlateAppearanceCorrection(
                                        snapshot,
                                        view,
                                        eventCorrectionReason.replace(/\s+/g, ' ').trim()
                                      )
                                    );
                                  } catch (error) {
                                    setNotice({
                                      tone: 'error',
                                      message: describeError(error, 'This event needs the advanced correction workflow.')
                                    });
                                  }
                                }}
                              >
                                Replace PA
                              </button>
                            </div>
                          </li>
                        );
                      })
                    ) : (
                      <li className="text-xs font-semibold text-gray-500">
                        {correctionSearch.trim()
                          ? `No loaded correction candidate matches “${correctionSearch.replace(/\s+/g, ' ').trim()}”. Load older events to widen the search.`
                          : 'No uncorrected events are eligible in the loaded window.'}
                      </li>
                    )}
                  </ol>
                </section>
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 font-semibold text-gray-500">
                Load a verified manager-private window before attaching notes or choosing a correction target. It reaches the current
                revision, and older blocks can be loaded progressively. Public recent-play rows are never treated as authoritative
                correction status.
              </p>
            )}
          </section>

          {snapshot.lifecycle === 'final' ? (
            <DiamondAiRecapCard
              state={recapState}
              generating={generatingRecap}
              publishing={publishingRecap}
              disabled={mutationDisabled || !networkOnline}
              onGenerate={() => void generateRecap()}
              onReviewPublication={() => setPublishRecapOpen(true)}
            />
          ) : null}
        </div>

        <aside className="space-y-3">
          <section className="app-card p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <UserRoundCheck className="text-primary-600 h-5 w-5" aria-hidden="true" />
              <h2 className="text-sm font-black text-gray-950">Scoring lease</h2>
            </div>
            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="text-sm font-black text-gray-900">
                {snapshot.lifecycle === 'cancelled'
                  ? 'Scorebook closed'
                  : snapshot.lease.canScore
                    ? 'You have the scorebook'
                    : snapshot.lease.status === 'available'
                      ? 'Scorebook is available'
                      : snapshot.lease.status === 'expired'
                        ? 'Scoring lease expired'
                        : snapshot.lease.status === 'unavailable'
                          ? 'Scoring lease unavailable'
                          : `${snapshot.lease.holderName || 'Another scorekeeper'} is scoring`}
              </div>
              <div className="mt-1 text-xs leading-5 font-semibold text-gray-600">
                {snapshot.lifecycle === 'cancelled'
                  ? 'The former lease grants no write authority after cancellation.'
                  : snapshot.lease.canScore
                    ? 'Only your confirmed commands can advance this revision.'
                    : leaseAction
                      ? 'Take the lease before recording a play. The server will invalidate any expired lease.'
                      : snapshot.lease.status === 'unavailable'
                        ? 'Lease evidence is incomplete, so all scoring writes remain disabled.'
                        : 'Controls stay read only until the current scorer hands off.'}
              </div>
            </div>
            {leaseAction ? (
              <button
                type="button"
                className="primary-button mt-3 w-full justify-center text-xs"
                disabled={
                  busy || reconciling || !networkOnline || !snapshot.authoritative || queueCount > 0 || snapshot.lifecycle === 'cancelled'
                }
                onClick={() => void changeScorerLease(leaseAction)}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <UserRoundCheck className="h-4 w-4" aria-hidden="true" />
                )}
                {leaseAction === 'recover' ? 'Recover scoring' : 'Acquire scorebook'}
              </button>
            ) : null}
            {snapshot.lifecycle !== 'cancelled' &&
            snapshot.lease.canScore &&
            snapshot.lease.holderUid === auth.user?.uid &&
            snapshot.lease.leaseId ? (
              <div className="mt-3">
                {!handoffOpen ? (
                  <button
                    type="button"
                    className="ghost-button w-full justify-center text-xs"
                    disabled={mutationDisabled || !networkOnline}
                    onClick={() => void loadHandoffCandidates()}
                  >
                    Hand off scorebook
                  </button>
                ) : (
                  <div className="rounded-xl border border-gray-200 bg-white p-3" aria-label="Scorer handoff candidates">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-black text-gray-700">Hand off to</div>
                      <button
                        type="button"
                        className="text-xs font-black text-gray-500 underline"
                        onClick={() => expireHandoffCandidates()}
                        disabled={busy}
                      >
                        Close handoff
                      </button>
                    </div>
                    {handoffLoading ? (
                      <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-gray-600" role="status">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        Loading complete scorer list
                      </div>
                    ) : handoffError ? (
                      <div className="mt-3">
                        <p className="text-xs leading-5 font-semibold text-rose-700" role="alert">
                          {handoffError}
                        </p>
                        <button
                          type="button"
                          className="ghost-button mt-2 w-full justify-center text-xs"
                          disabled={mutationDisabled || !networkOnline}
                          onClick={() => void loadHandoffCandidates()}
                        >
                          Retry scorer list
                        </button>
                      </div>
                    ) : otherScorers.length ? (
                      <>
                        <label className="sr-only" htmlFor="diamond-handoff-target">
                          Hand off to
                        </label>
                        <select
                          id="diamond-handoff-target"
                          className="mt-2 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold text-gray-900"
                          value={handoffTarget}
                          onChange={(event) => setHandoffTarget(event.target.value)}
                          disabled={mutationDisabled || !networkOnline}
                        >
                          {otherScorers.map((scorer) => (
                            <option key={scorer.playerId} value={scorer.playerId}>
                              {playerLabel(scorer)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="ghost-button mt-2 w-full justify-center text-xs"
                          disabled={!handoffTarget || mutationDisabled || !networkOnline}
                          onClick={() => {
                            const target = otherScorers.find((scorer) => scorer.playerId === handoffTarget);
                            if (target) setConfirmation({ kind: 'handoff', toUid: target.playerId, toName: target.name });
                          }}
                        >
                          Confirm handoff
                        </button>
                      </>
                    ) : (
                      <p className="mt-3 text-xs leading-5 font-semibold text-gray-600">No other eligible scorekeepers are available.</p>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </section>

          <section className="app-card p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-black text-gray-950">Batting order</h2>
              <span className="bg-primary-50 text-primary-700 rounded-full px-2 py-1 text-[10px] font-black tracking-wide uppercase">
                {snapshot.inning.half === 'top' ? 'Away' : 'Home'}
              </span>
            </div>
            <ol className="mt-3 space-y-1" aria-label="Current batting order">
              {snapshot.battingLineup.length ? (
                snapshot.battingLineup.map((player) => {
                  const active = player.playerId === snapshot.currentBatter?.playerId;
                  return (
                    <li
                      key={`${player.slot}:${player.playerId}`}
                      className={`flex min-h-10 items-center gap-3 rounded-xl px-2 ${active ? 'bg-primary-50 text-primary-950' : 'text-gray-700'}`}
                    >
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${active ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {player.slot}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-bold">{playerLabel(player)}</span>
                      {active ? <span className="text-primary-600 text-[10px] font-black tracking-wide uppercase">Up</span> : null}
                    </li>
                  );
                })
              ) : (
                <li className="py-3 text-center text-xs font-semibold text-gray-500">Lineup is not available.</li>
              )}
            </ol>
          </section>

          <CompletenessCard snapshot={snapshot} />

          {pinnedRulesProfile && ['ready', 'active', 'suspended', 'correction'].includes(snapshot.lifecycle) ? (
            <RulesDecisionPanel
              snapshot={snapshot}
              rulesProfile={pinnedRulesProfile}
              disabled={mutationDisabled}
              online={networkOnline}
              onReview={(decision) => setConfirmation({ kind: 'rules-decision', ...decision })}
            />
          ) : null}

          <section className="app-card p-3 sm:p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-emerald-600" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-black text-gray-950">Finish deliberately</h2>
                <p className="mt-1 text-xs leading-5 font-semibold text-gray-600">
                  Finalizing locks ordinary scoring. The server accepts it only after a regulation, walkoff, run-ahead, or audited
                  game-ending decision. Any later change must reopen a visible correction session.
                </p>
              </div>
            </div>
            {snapshot.lifecycle === 'cancelled' ? (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs leading-5 font-semibold text-gray-700">
                A cancelled game cannot be finalized or reopened from the scorer. Its existing history remains read only.
              </div>
            ) : snapshot.lifecycle === 'final' ? (
              <div className="mt-3">
                {snapshot.finalizationReason ? (
                  <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 font-semibold text-emerald-900">
                    Finalized by {snapshot.finalizationReason.kind.replace('-', ' ')} evidence
                    {snapshot.finalizationReason.decisionEventId ? ` · ${snapshot.finalizationReason.decisionEventId}` : ''}.
                  </div>
                ) : null}
                <label className="text-xs font-black text-gray-700" htmlFor="diamond-correction-reason">
                  Correction reason
                </label>
                <textarea
                  id="diamond-correction-reason"
                  className="mt-1 min-h-20 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                  value={correctionReason}
                  maxLength={300}
                  placeholder="What official scoring decision needs review?"
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  disabled={mutationDisabled}
                />
                <button
                  type="button"
                  className="mt-2 min-h-11 w-full rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm font-black text-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={mutationDisabled || !networkOnline || !correctionReason.trim()}
                  onClick={() => setConfirmation({ kind: 'reopen', reason: correctionReason.replace(/\s+/g, ' ').trim() })}
                >
                  Review correction reopening
                </button>
              </div>
            ) : (
              <div className="mt-3">
                {snapshot.gameEndDecision ? (
                  <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 font-semibold text-amber-950">
                    Audited {snapshot.gameEndDecision.reason.replace('-', ' ')} ending recorded at{' '}
                    {snapshot.gameEndDecision.decisionEventId}. Finalization still requires a separate confirmation.
                  </div>
                ) : ['ready', 'suspended'].includes(snapshot.lifecycle) ? (
                  <div className="mb-2 text-xs leading-5 font-semibold text-gray-600">
                    Record an applicable audited game-ending decision before finalizing from this {snapshot.lifecycle} state.
                  </div>
                ) : null}
                <button
                  type="button"
                  className="min-h-11 w-full rounded-xl border border-rose-200 bg-rose-50 px-3 text-sm font-black text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={mutationDisabled || !finalizationCanBeReviewed}
                  onClick={() => setConfirmation({ kind: 'finalize' })}
                >
                  Review final score
                </button>
              </div>
            )}
          </section>
        </aside>
      </section>

      {pendingPlay ? (
        <PlayReviewModal
          pending={pendingPlay}
          snapshot={snapshot}
          controlMode={controlMode}
          busy={busy}
          onChange={setPendingPlay}
          onClose={() => setPendingPlay(null)}
          onConfirm={() => void confirmPendingPlay()}
        />
      ) : null}

      {voiceOpen ? (
        <VoiceModal
          intent={voiceIntent}
          draft={voiceDraft}
          dictating={dictating}
          interpreting={interpreting}
          savingNote={savingNote}
          questions={voiceQuestions}
          confidence={voiceConfidence}
          online={networkOnline}
          canInterpret={!mutationDisabled && snapshot.lifecycle === 'active'}
          attachToLastPlay={attachNoteToLastPlay}
          hasRecentPlay={Boolean(attachableHistory.length)}
          onDraftChange={(value) => {
            setVoiceDraft(value);
            setVoiceQuestions([]);
            setVoiceConfidence(null);
          }}
          onIntentChange={(value) => {
            setVoiceIntent(value);
            setVoiceQuestions([]);
            setVoiceConfidence(null);
          }}
          onToggleDictation={() => void toggleDictation()}
          onAttachChange={setAttachNoteToLastPlay}
          onInterpret={() => void interpretVoice()}
          onSaveNote={() => void savePrivateNote()}
          onClose={() => {
            if (dictating) void toggleDictation();
            setVoiceDraft('');
            setVoiceQuestions([]);
            setVoiceConfidence(null);
            setVoiceOpen(false);
          }}
        />
      ) : null}

      {confirmation ? (
        <ConfirmationModal
          confirmation={confirmation}
          snapshot={snapshot}
          busy={busy}
          onClose={() => setConfirmation(null)}
          onConfirm={() => void handleConfirmation()}
        />
      ) : null}

      {publishRecapOpen && recapState ? (
        <DiamondAiPublishModal
          state={recapState}
          busy={publishingRecap}
          onClose={() => setPublishRecapOpen(false)}
          onConfirm={() => void publishRecap()}
        />
      ) : null}
    </div>
  );
}

function DiamondAiRecapCard({
  state,
  generating,
  publishing,
  disabled,
  onGenerate,
  onReviewPublication
}: {
  state: DiamondAiDraftState | null;
  generating: boolean;
  publishing: boolean;
  disabled: boolean;
  onGenerate: () => void;
  onReviewPublication: () => void;
}) {
  return (
    <section className="app-card border-violet-200 p-3 sm:p-4" aria-labelledby="diamond-ai-recap-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="diamond-ai-recap-title" className="text-base font-black text-gray-950">
              Post-game AI draft
            </h2>
            <p className="mt-0.5 text-xs leading-5 font-semibold text-gray-600">
              Generated only from the sanitized, revision-pinned play and stat packet. Nothing publishes automatically.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="ghost-button !min-h-10 !px-3 text-xs"
          disabled={disabled || generating || publishing}
          onClick={onGenerate}
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          )}
          {generating ? 'Generating draft…' : state ? 'Regenerate AI draft' : 'Generate AI draft'}
        </button>
      </div>

      {!state ? (
        <div className="mt-4 rounded-xl border border-dashed border-violet-200 bg-violet-50/50 p-4 text-center text-sm font-semibold text-violet-900">
          Generate creates an unpublished local review draft. Publication requires a separate confirmation.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-black tracking-wide uppercase">
            <span className="rounded-full bg-violet-100 px-2 py-1 text-violet-800">Draft · unpublished</span>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-700">Source revision {state.source.sourceRevision}</span>
            {state.stale ? <span className="rounded-full bg-rose-100 px-2 py-1 text-rose-800">Stale after correction</span> : null}
          </div>

          {state.stale ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 font-bold text-rose-900" role="alert">
              The scorebook no longer matches this source revision. This draft cannot be published; generate a new one after corrections are
              final.
            </div>
          ) : null}

          <DiamondAiDraftBlockView title="Draft recap" block={state.draft.recap} source={state.source} />

          <div>
            <h3 className="text-xs font-black tracking-wide text-gray-700 uppercase">Stat insights</h3>
            {state.draft.insights.length ? (
              <div className="mt-2 space-y-2">
                {state.draft.insights.map((insight, index) => (
                  <DiamondAiDraftBlockView
                    key={`${index}:${insight.text}`}
                    title={`Insight ${index + 1}`}
                    block={insight}
                    source={state.source}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs font-semibold text-gray-500">
                No supported statistical insight was available in the source packet.
              </p>
            )}
          </div>

          <div>
            <h3 className="text-xs font-black tracking-wide text-gray-700 uppercase">Coverage disclosure</h3>
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="AI draft source coverage">
              {diamondCoverageFamilies.map((family) => {
                const status = state.draft.coverage[family];
                return (
                  <li
                    key={family}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-black ${status === 'complete' ? 'bg-emerald-50 text-emerald-800' : status === 'partial' ? 'bg-amber-50 text-amber-900' : 'bg-gray-100 text-gray-700'}`}
                  >
                    {family.replace('_', ' ')} · {status.replace('_', ' ')}
                  </li>
                );
              })}
            </ul>
            {state.draft.dataQualityNotes.length ? (
              <ul className="mt-2 space-y-1 text-xs leading-5 font-semibold text-gray-600" aria-label="AI draft data quality notes">
                {state.draft.dataQualityNotes.map((note) => (
                  <li key={note}>• {note}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs font-semibold text-gray-600">Every supplied stat family is marked complete.</p>
            )}
          </div>

          {state.publication ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-950">
              <div className="text-sm font-black">Publication confirmed</div>
              <div className="mt-1 text-xs leading-5 font-semibold">
                {state.publication.publicationId} · revision {state.publication.sourceRevision} · {state.publication.publishedAt}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="primary-button w-full justify-center"
              disabled={disabled || state.stale || generating || publishing}
              onClick={onReviewPublication}
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Review publication
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function DiamondAiDraftBlockView({
  title,
  block,
  source
}: {
  title: string;
  block: DiamondAiGameDraft['recap'];
  source: DiamondRecapSource;
}) {
  const playLookup = new Map(source.packet.plays.map((play) => [play.eventId, play]));
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-3">
      <h3 className="text-xs font-black tracking-wide text-gray-700 uppercase">{title}</h3>
      <p className="mt-2 text-sm leading-6 font-semibold text-gray-900">{block.text}</p>
      <div className="mt-3">
        <div className="text-[10px] font-black tracking-wider text-gray-500 uppercase">Play citations</div>
        <ul className="mt-1 space-y-1 text-xs leading-5 font-semibold text-gray-600">
          {block.citations.map((citation) => {
            const play = playLookup.get(citation.eventId);
            return (
              <li key={`${citation.eventId}:${citation.revision}`}>
                <span className="font-black text-gray-800">{citation.eventId}</span> · rev {citation.revision}
                {play?.inningLabel ? ` · ${play.inningLabel}` : ''}
                {play?.summary ? ` — ${play.summary}` : ''}
              </li>
            );
          })}
        </ul>
      </div>
      {block.statRefs.length ? (
        <div className="mt-2 text-[11px] font-bold text-gray-500">
          Stat sources: {block.statRefs.map((reference) => `${reference.statId}.${reference.metric}`).join(', ')}
        </div>
      ) : null}
    </article>
  );
}

function DiamondAiPublishModal({
  state,
  busy,
  onClose,
  onConfirm
}: {
  state: DiamondAiDraftState;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal onClose={onClose} ariaLabelledBy="diamond-ai-publish-title">
      <section className="app-card w-full max-w-md p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-50 text-violet-700">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 id="diamond-ai-publish-title" className="mt-3 text-xl font-black text-gray-950">
          Publish AI recap?
        </h2>
        <p className="mt-2 text-sm leading-6 font-semibold text-gray-600">
          AI can be wrong. Publish only after checking every cited play, statistic, and coverage disclosure against final revision{' '}
          {state.source.sourceRevision}. The server will reject publication if the checkpoint changed.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="ghost-button justify-center" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primary-button justify-center" onClick={onConfirm} disabled={busy || state.stale}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            )}
            Publish recap
          </button>
        </div>
      </section>
    </Modal>
  );
}

function LineupSetup({
  snapshot,
  drafts,
  dirty,
  defenseDrafts,
  defenseDirty,
  disabled,
  online,
  onChange,
  onAddManual,
  onSave,
  onDefenseChange,
  onDefenseSave,
  onStart,
  canStart,
  battingRoles
}: {
  snapshot: DiamondScorebookSnapshot;
  drafts: LineupDrafts;
  dirty: Record<DiamondSide, boolean>;
  defenseDrafts: DefenseDrafts;
  defenseDirty: Record<DiamondSide, boolean>;
  disabled: boolean;
  online: boolean;
  onChange: (side: DiamondSide, entries: DiamondLineupEntry[]) => void;
  onAddManual: (side: DiamondSide, name: string, number: string) => boolean;
  onSave: (side: DiamondSide) => void;
  onDefenseChange: (side: DiamondSide, position: DiamondDefensivePosition, playerId: string) => void;
  onDefenseSave: (side: DiamondSide) => void;
  onStart: () => void;
  canStart: boolean;
  battingRoles: readonly DiamondBattingRole[];
}) {
  return (
    <section className="app-card border-sky-200 p-3 sm:p-4" aria-labelledby="diamond-lineup-setup-title">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-sky-700" aria-hidden="true" />
        <div>
          <h2 id="diamond-lineup-setup-title" className="text-base font-black text-gray-950">
            Set lineups and defense
          </h2>
          <p className="mt-1 text-xs leading-5 font-semibold text-gray-600">
            Save each batting order and defensive alignment. Start stays locked until both lineups and both starting pitchers are
            authoritative.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {(['away', 'home'] as const).map((side) => (
          <div key={side} className="space-y-3">
            <LineupSideEditor
              side={side}
              name={side === 'home' ? snapshot.homeName : snapshot.awayName}
              entries={drafts[side]}
              candidates={snapshot.availablePlayers[side]}
              dirty={dirty[side]}
              disabled={disabled}
              online={online}
              battingRoles={battingRoles}
              onChange={(entries) => onChange(side, entries)}
              onAddManual={(name, number) => onAddManual(side, name, number)}
              onSave={() => onSave(side)}
            />
            <DefenseAlignmentEditor
              side={side}
              name={side === 'home' ? snapshot.homeName : snapshot.awayName}
              assignments={defenseDrafts[side]}
              players={[...snapshot.availablePlayers[side], ...drafts[side]].filter(
                (player, index, all) => all.findIndex((candidate) => candidate.playerId === player.playerId) === index
              )}
              dirty={defenseDirty[side]}
              disabled={disabled}
              online={online}
              onChange={(position, playerId) => onDefenseChange(side, position, playerId)}
              onSave={() => onDefenseSave(side)}
            />
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sky-950">
        <div className="text-sm font-black">{canStart ? 'Lineups and pitchers are authoritative' : 'Start is locked'}</div>
        <div className="mt-1 text-xs leading-5 font-semibold">
          {canStart
            ? 'Confirm the batting orders and starting pitchers once more, then start the game.'
            : 'Save each batting order, choose each starting pitcher, and save every unsaved change.'}
        </div>
        <button
          type="button"
          className="primary-button mt-3 w-full justify-center sm:w-auto"
          disabled={disabled || !online || !canStart}
          onClick={onStart}
        >
          Start game
        </button>
      </div>
    </section>
  );
}

function DefenseAlignmentEditor({
  side,
  name,
  assignments,
  players,
  dirty,
  disabled,
  online,
  onChange,
  onSave
}: {
  side: DiamondSide;
  name: string;
  assignments: Partial<Record<DiamondDefensivePosition, string>>;
  players: DiamondPlayerRef[];
  dirty: boolean;
  disabled: boolean;
  online: boolean;
  onChange: (position: DiamondDefensivePosition, playerId: string) => void;
  onSave: () => void;
}) {
  const assignedCount = Object.values(assignments).filter(Boolean).length;
  const selectedIds = new Set(Object.values(assignments).filter(Boolean));
  return (
    <fieldset className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3">
      <legend className="px-1 text-sm font-black text-gray-950">{name} defense</legend>
      <p className="mt-1 text-xs leading-5 font-semibold text-gray-600">
        Pitcher is required. Add catcher and every observed position for a complete defensive lineup; use LCF/RCF only for four-outfielder
        rules.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {defensivePositions.map((position) => {
          const current = assignments[position] || '';
          return (
            <label key={position} className="text-[11px] font-black text-gray-700">
              {position === 'P' ? 'P · required' : position}
              <select
                aria-label={`${name} ${position}`}
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
                value={current}
                disabled={disabled}
                onChange={(event) => onChange(position, event.target.value)}
              >
                <option value="">Unassigned</option>
                {players.map((player) => (
                  <option
                    key={player.playerId}
                    value={player.playerId}
                    disabled={selectedIds.has(player.playerId) && player.playerId !== current}
                  >
                    {playerLabel(player)}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      {assignedCount > 10 ? (
        <div className="mt-2 text-xs font-bold text-rose-700" role="alert">
          A saved defensive alignment can contain at most 10 assignments.
        </div>
      ) : null}
      <button
        type="button"
        className="primary-button mt-3 w-full justify-center"
        disabled={disabled || !online || !dirty || !assignments.P || assignedCount > 10}
        onClick={onSave}
      >
        Save {side} defense
      </button>
      {!online ? <div className="mt-2 text-xs font-bold text-amber-800">Reconnect to save this defense.</div> : null}
    </fieldset>
  );
}

function ActiveDefenseAlignmentEditor({
  side,
  name,
  assignments,
  players,
  dirty,
  disabled,
  onSwap,
  onReview
}: {
  side: DiamondSide;
  name: string;
  assignments: Partial<Record<DiamondDefensivePosition, string>>;
  players: DiamondPlayerRef[];
  dirty: boolean;
  disabled: boolean;
  onSwap: (position: DiamondDefensivePosition, playerId: string) => void;
  onReview: () => void;
}) {
  const occupiedPositions = defensivePositions.filter((position) => Boolean(assignments[position]));
  const assignedPlayers = canonicalDefenseAssignments(assignments).map((assignment) => assignment.playerId);
  const valid = Boolean(
    assignments.P &&
    occupiedPositions.length >= 2 &&
    occupiedPositions.length <= 10 &&
    new Set(assignedPlayers).size === assignedPlayers.length &&
    defensePersonnelFingerprint(assignments) === JSON.stringify(players.map((player) => player.playerId).sort())
  );
  return (
    <fieldset className="app-card border-emerald-200 bg-emerald-50/40 p-3 sm:p-4">
      <legend className="px-1 text-sm font-black text-gray-950">Live {name} defense</legend>
      <p className="mt-1 text-xs leading-5 font-semibold text-gray-600">
        Swap two currently active fielders, then review the complete alignment. Substitutions and re-entry stay on their separate confirmed
        paths.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {occupiedPositions.map((position) => (
          <label key={position} className="text-[11px] font-black text-gray-700">
            {position}
            <select
              aria-label={`Live ${name} ${position}`}
              className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
              value={assignments[position] || ''}
              disabled={disabled || !valid}
              onChange={(event) => onSwap(position, event.target.value)}
            >
              {players.map((player) => (
                <option key={player.playerId} value={player.playerId}>
                  {playerLabel(player)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="primary-button mt-3 w-full justify-center sm:w-auto"
        disabled={disabled || !dirty || !valid}
        onClick={onReview}
      >
        Review {side} defense change
      </button>
      <div className="mt-2 text-xs leading-5 font-semibold text-gray-600">
        Offline confirmation queues this revision-bound swap first and locks later scoring until ordered reconciliation.
      </div>
    </fieldset>
  );
}

function LineupSideEditor({
  side,
  name,
  entries,
  candidates,
  dirty,
  disabled,
  online,
  battingRoles,
  onChange,
  onAddManual,
  onSave
}: {
  side: DiamondSide;
  name: string;
  entries: DiamondLineupEntry[];
  candidates: DiamondPlayerRef[];
  dirty: boolean;
  disabled: boolean;
  online: boolean;
  battingRoles: readonly DiamondBattingRole[];
  onChange: (entries: DiamondLineupEntry[]) => void;
  onAddManual: (name: string, number: string) => boolean;
  onSave: () => void;
}) {
  const [candidateId, setCandidateId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualNumber, setManualNumber] = useState('');
  const available = candidates.filter((candidate) => !entries.some((entry) => entry.playerId === candidate.playerId));
  const prefix = `diamond-${side}-lineup`;
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  return (
    <fieldset className="rounded-2xl border border-gray-200 bg-white p-3">
      <legend className="px-1 text-sm font-black text-gray-950">
        {side === 'away' ? 'Away' : 'Home'} · {name}
      </legend>
      <ol className="mt-2 space-y-2" aria-label={`${name} batting order editor`}>
        {entries.map((entry, index) => (
          <li key={entry.playerId} className="rounded-xl border border-gray-200 bg-gray-50 p-2">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-gray-900 text-xs font-black text-white">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-black text-gray-950">{playerLabel(entry)}</span>
              <button
                type="button"
                className="ghost-button !h-11 !min-h-11 !w-11 !p-0"
                aria-label={`Move ${entry.name} up`}
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ghost-button !h-11 !min-h-11 !w-11 !p-0"
                aria-label={`Move ${entry.name} down`}
                disabled={disabled || index === entries.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ghost-button !h-11 !min-h-11 !w-11 !p-0 text-rose-700"
                aria-label={`Remove ${entry.name}`}
                disabled={disabled}
                onClick={() => onChange(entries.filter((candidate) => candidate.playerId !== entry.playerId))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {battingRoles.length > 1 ? (
              <label className="mt-2 block text-[11px] font-black text-gray-600">
                Batting role
                <select
                  aria-label={`${entry.name} batting role`}
                  className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-2 text-xs font-bold"
                  value={normalizeInitialBattingRole(entry.battingRole, battingRoles)}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      entries.map((candidate) =>
                        candidate.playerId === entry.playerId
                          ? { ...candidate, battingRole: event.target.value as DiamondBattingRole }
                          : candidate
                      )
                    )
                  }
                >
                  {battingRoles.map((role) => (
                    <option key={role} value={role}>
                      {battingRoleLabels[role]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </li>
        ))}
        {!entries.length ? (
          <li className="rounded-xl border border-dashed border-gray-300 p-3 text-center text-xs font-bold text-gray-500">
            No players added yet.
          </li>
        ) : null}
      </ol>

      {available.length ? (
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="sr-only" htmlFor={`${prefix}-candidate`}>
            Add roster player to {name}
          </label>
          <select
            id={`${prefix}-candidate`}
            className="min-h-11 min-w-0 rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
            value={candidateId}
            disabled={disabled || entries.length >= 25}
            onChange={(event) => setCandidateId(event.target.value)}
          >
            <option value="">Choose roster player</option>
            {available.map((candidate) => (
              <option key={candidate.playerId} value={candidate.playerId}>
                {playerLabel(candidate)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ghost-button !px-3 text-xs"
            disabled={disabled || !candidateId || entries.length >= 25}
            onClick={() => {
              const player = available.find((candidate) => candidate.playerId === candidateId);
              if (!player) return;
              onChange([...entries, { ...player, slot: entries.length + 1, active: true, battingRole: 'regular' }]);
              setCandidateId('');
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </button>
        </div>
      ) : null}

      <details className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <summary className="cursor-pointer text-xs font-black text-gray-800">Add manual opponent/player</summary>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
          <label className="text-[11px] font-black text-gray-600">
            Name
            <input
              className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold"
              value={manualName}
              maxLength={100}
              disabled={disabled}
              onChange={(event) => setManualName(event.target.value)}
            />
          </label>
          <label className="text-[11px] font-black text-gray-600">
            Number
            <input
              className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-semibold"
              value={manualNumber}
              maxLength={12}
              disabled={disabled}
              onChange={(event) => setManualNumber(event.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          className="ghost-button mt-2 w-full justify-center text-xs"
          disabled={disabled || !manualName.trim() || entries.length >= 25}
          onClick={() => {
            if (!onAddManual(manualName, manualNumber)) return;
            setManualName('');
            setManualNumber('');
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add manual player
        </button>
      </details>

      <button
        type="button"
        className="primary-button mt-3 w-full justify-center"
        disabled={disabled || !online || !dirty || entries.length < 1}
        onClick={onSave}
      >
        Save {side} lineup
      </button>
      {!online ? <div className="mt-2 text-xs font-bold text-amber-800">Reconnect to save this lineup.</div> : null}
    </fieldset>
  );
}

type RulesDecisionChoice = {
  code: SupportedRulesDecisionCode;
  label: string;
  detail: string;
  opensFinalization: boolean;
};

function getRulesDecisionChoices(snapshot: DiamondScorebookSnapshot, profile: DiamondRulesProfile): RulesDecisionChoice[] {
  if (snapshot.gameEndDecision) return [];
  const choices: RulesDecisionChoice[] = [];
  if (snapshot.lifecycle === 'active' && profile.inningRunLimit !== null && !snapshot.halfInningEnd) {
    choices.push({
      code: 'end_half_inning_run_limit',
      label: `End half at ${profile.inningRunLimit}-run cap`,
      detail: 'The server verifies that this half reached the pinned run limit. This does not finalize the game.',
      opensFinalization: false
    });
  }
  if (['active', 'suspended', 'correction'].includes(snapshot.lifecycle) && profile.timeLimitMinutes !== null) {
    choices.push({
      code: 'end_game_time_limit',
      label: `End game at ${profile.timeLimitMinutes}-minute limit`,
      detail: 'Use only after the umpire or tournament authority has ended the game; the scorebook does not infer elapsed time.',
      opensFinalization: true
    });
  }
  if (['active', 'suspended', 'correction'].includes(snapshot.lifecycle)) {
    choices.push({
      code: 'end_game_weather',
      label: 'End game for weather or field conditions',
      detail: 'Records an observed official ending. It does not decide whether the game is complete under local competition policy.',
      opensFinalization: true
    });
  }
  if (['ready', 'active', 'suspended', 'correction'].includes(snapshot.lifecycle)) {
    choices.push(
      {
        code: 'end_game_forfeit_home',
        label: `Forfeit — award ${snapshot.homeName} (home)`,
        detail: 'Records the home side as the awarded winner. Confirm the official ruling before continuing.',
        opensFinalization: true
      },
      {
        code: 'end_game_forfeit_away',
        label: `Forfeit — award ${snapshot.awayName} (away)`,
        detail: 'Records the away side as the awarded winner. Confirm the official ruling before continuing.',
        opensFinalization: true
      }
    );
  }
  return choices;
}

function RulesDecisionPanel({
  snapshot,
  rulesProfile,
  disabled,
  online,
  onReview
}: {
  snapshot: DiamondScorebookSnapshot;
  rulesProfile: DiamondRulesProfile;
  disabled: boolean;
  online: boolean;
  onReview: (decision: Omit<Extract<Confirmation, { kind: 'rules-decision' }>, 'kind'>) => void;
}) {
  const choices = getRulesDecisionChoices(snapshot, rulesProfile);
  const [selectedCode, setSelectedCode] = useState<SupportedRulesDecisionCode>(choices[0]?.code || 'end_game_weather');
  const [description, setDescription] = useState('');
  const selected = choices.find((choice) => choice.code === selectedCode) || choices[0] || null;
  const normalizedDescription = description.replace(/\s+/g, ' ').trim();
  const descriptionValid = normalizedDescription.length >= 1 && normalizedDescription.length <= 500;

  useEffect(() => {
    if (selected && selected.code !== selectedCode) setSelectedCode(selected.code);
  }, [selected, selectedCode]);

  useEffect(() => {
    setDescription('');
  }, [snapshot.gameEndDecision?.decisionEventId, snapshot.halfInningEnd?.decisionEventId]);

  return (
    <section className="app-card border-amber-200 p-3 sm:p-4" aria-labelledby="diamond-rules-decision-title">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-amber-700" aria-hidden="true" />
        <div>
          <h2 id="diamond-rules-decision-title" className="text-sm font-black text-gray-950">
            Official rules decision
          </h2>
          <p className="mt-1 text-xs leading-5 font-semibold text-gray-600">
            The current scorer records the observed ruling; the server verifies the pinned {rulesProfile.name} profile and lifecycle.
          </p>
        </div>
      </div>

      {snapshot.gameEndDecision ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 font-semibold text-amber-950">
          {snapshot.gameEndDecision.reason === 'forfeit'
            ? `${snapshot.gameEndDecision.awardedSide === 'home' ? snapshot.homeName : snapshot.awayName} was awarded the game`
            : `Game ended for ${snapshot.gameEndDecision.reason.replace('-', ' ')}`}{' '}
          · decision {snapshot.gameEndDecision.decisionEventId}. Use the separate final-score confirmation below.
        </div>
      ) : choices.length ? (
        <fieldset className="mt-3" aria-describedby="diamond-rules-decision-scope">
          <legend className="sr-only">Choose and describe an official rules decision</legend>
          <label className="text-xs font-black text-gray-700" htmlFor="diamond-rules-decision-code">
            Ruling
          </label>
          <select
            id="diamond-rules-decision-code"
            className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold text-gray-900"
            value={selected?.code || ''}
            disabled={disabled || !online}
            onChange={(event) => {
              setSelectedCode(event.target.value as SupportedRulesDecisionCode);
              setDescription('');
            }}
          >
            {choices.map((choice) => (
              <option key={choice.code} value={choice.code}>
                {choice.label}
              </option>
            ))}
          </select>
          {selected ? <p className="mt-2 text-xs leading-5 font-semibold text-gray-600">{selected.detail}</p> : null}
          <label className="mt-3 block text-xs font-black text-gray-700" htmlFor="diamond-rules-decision-description">
            Official ruling description
          </label>
          <textarea
            id="diamond-rules-decision-description"
            className="mt-1 min-h-20 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
            value={description}
            maxLength={500}
            aria-describedby="diamond-rules-decision-description-help"
            placeholder="Who made the ruling, and what was announced?"
            disabled={disabled || !online}
            onChange={(event) => setDescription(event.target.value)}
          />
          <div id="diamond-rules-decision-description-help" className="mt-1 text-[11px] font-semibold text-gray-500">
            Required · 1–500 characters · stored in the append-only audit trail.
          </div>
          <button
            type="button"
            className="mt-3 min-h-11 w-full rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm font-black text-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || !online || !selected || !descriptionValid}
            onClick={() =>
              selected &&
              onReview({
                code: selected.code,
                label: selected.label,
                description: normalizedDescription,
                opensFinalization: selected.opensFinalization
              })
            }
          >
            Review rule decision
          </button>
        </fieldset>
      ) : (
        <p className="mt-3 text-xs leading-5 font-semibold text-gray-600">No additional audited ending is available for this game state.</p>
      )}

      <p id="diamond-rules-decision-scope" className="mt-3 text-[11px] leading-5 font-semibold text-gray-500">
        These controls do not infer missing facts or automate advisory look-back and leaving-early calls. A run cap ends only the current
        half; every game ending still requires a separate final confirmation.
      </p>
      {!online ? <div className="mt-2 text-xs font-bold text-amber-800">Reconnect before recording an official ruling.</div> : null}
    </section>
  );
}

function AdvancedScoringPanel({
  snapshot,
  rulesProfile,
  disabled,
  attachableEvents,
  historyLoaded,
  historyLoading,
  onLoadHistory,
  onReview
}: {
  snapshot: DiamondScorebookSnapshot;
  rulesProfile: DiamondRulesProfile | null;
  disabled: boolean;
  attachableEvents: DiamondEffectivePrivateEvent[];
  historyLoaded: boolean;
  historyLoading: boolean;
  onLoadHistory: () => void;
  onReview: (type: DiamondCommandType, label: string, payload: DiamondJsonObject) => void;
}) {
  const battingSide: DiamondSide = snapshot.inning.half === 'top' ? 'away' : 'home';
  const occupiedBases = (['first', 'second', 'third'] as const).flatMap((base) => {
    const runner = snapshot.bases[base];
    return runner ? [{ base, runner }] : [];
  });
  const [runnerBase, setRunnerBase] = useState<'first' | 'second' | 'third'>('first');
  const [runnerAction, setRunnerAction] = useState<DiamondRunnerAdvanceCause>('stolen_base');
  const [runnerDestination, setRunnerDestination] = useState<RunnerDestination>('second');
  const [runnerOutKind, setRunnerOutKind] = useState<DiamondOutKind>('tag');
  const [runnerCountsRun, setRunnerCountsRun] = useState(true);
  const [runnerEarned, setRunnerEarned] = useState<'' | 'earned' | 'unearned'>('');
  const [runnerRbi, setRunnerRbi] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [subSide, setSubSide] = useState<DiamondSide>(battingSide);
  const [subSlot, setSubSlot] = useState('1');
  const [incomingPlayerId, setIncomingPlayerId] = useState('');
  const [subDefensivePosition, setSubDefensivePosition] = useState<DiamondDefensivePosition | ''>('');
  const [structuredType, setStructuredType] = useState<'record_fielding' | 'record_scoring_judgment'>('record_fielding');
  const [structuredPlayId, setStructuredPlayId] = useState('');
  const [fieldingPutout, setFieldingPutout] = useState('');
  const [fieldingAssistOne, setFieldingAssistOne] = useState('');
  const [fieldingAssistTwo, setFieldingAssistTwo] = useState('');
  const [fieldingErrorPlayer, setFieldingErrorPlayer] = useState('');
  const [fieldingErrorKind, setFieldingErrorKind] = useState<'fielding' | 'throwing'>('fielding');
  const [fieldingPassedBall, setFieldingPassedBall] = useState('');
  const [fieldingBattedBall, setFieldingBattedBall] = useState<'unknown' | 'ground' | 'line' | 'fly' | 'bunt'>('unknown');
  const [fieldingLocation, setFieldingLocation] = useState('');
  const [fieldingDoublePlay, setFieldingDoublePlay] = useState(false);
  const [fieldingTriplePlay, setFieldingTriplePlay] = useState(false);
  const [judgmentRunnerId, setJudgmentRunnerId] = useState('');
  const [judgmentEarned, setJudgmentEarned] = useState<'' | 'yes' | 'no'>('');
  const [judgmentRbi, setJudgmentRbi] = useState<'' | 'yes' | 'no'>('');
  const [judgmentPitcherId, setJudgmentPitcherId] = useState('');
  const [pitcherDecision, setPitcherDecision] = useState<'' | 'win' | 'loss' | 'save'>('');
  const [pitcherDecisionSide, setPitcherDecisionSide] = useState<DiamondSide>('home');
  const [pitcherDecisionPlayerId, setPitcherDecisionPlayerId] = useState('');
  const [structuredError, setStructuredError] = useState('');
  const [dpSide, setDpSide] = useState<DiamondSide>(battingSide);
  const [dpPlayerId, setDpPlayerId] = useState('');
  const [flexPlayerId, setFlexPlayerId] = useState('');
  const [dpPosition, setDpPosition] = useState<(typeof defensivePositions)[number]>('P');
  const [courtesyBase, setCourtesyBase] = useState<'first' | 'second' | 'third'>('first');
  const [courtesyRole, setCourtesyRole] = useState<'pitcher' | 'catcher'>('pitcher');
  const [courtesyRunnerId, setCourtesyRunnerId] = useState('');

  useEffect(() => {
    if (!attachableEvents.length) {
      setStructuredPlayId('');
      return;
    }
    if (!attachableEvents.some((event) => event.sourceEventId === structuredPlayId)) {
      setStructuredPlayId(attachableEvents[attachableEvents.length - 1]!.sourceEventId);
    }
  }, [attachableEvents, structuredPlayId]);

  const activeRunner = occupiedBases.find((entry) => entry.base === runnerBase) || occupiedBases[0] || null;
  const subLineup = snapshot.lineups[subSide];
  const subEntry = subLineup.find((entry) => entry.slot === Number(subSlot)) || subLineup[0] || null;
  const currentSubPosition = subEntry
    ? (Object.entries(snapshot.defense[subSide]).find(([, player]) => player?.playerId === subEntry.playerId)?.[0] as
        DiamondDefensivePosition | undefined)
    : undefined;
  const liveSubstitutionRunnerIds = new Set(liveSubstitutionPlacements(snapshot, subSide).map(({ runner }) => runner.playerId));
  const reentryAvailable = Boolean(
    subEntry &&
    subEntry.starterPlayerId &&
    subEntry.starterPlayerId !== subEntry.playerId &&
    !liveSubstitutionRunnerIds.has(subEntry.starterPlayerId) &&
    !subLineup.some((entry) => entry.slot !== subEntry.slot && entry.playerId === subEntry.starterPlayerId) &&
    (rulesProfile?.freeSubstitution || (subEntry.starterReentriesUsed || 0) < (rulesProfile?.starterReentryLimit || 0))
  );
  const subCandidates = snapshot.availablePlayers[subSide].filter(
    (player) =>
      !subLineup.some((entry) => entry.playerId === player.playerId) &&
      player.playerId !== subEntry?.playerId &&
      !liveSubstitutionRunnerIds.has(player.playerId)
  );
  const incomingSubCandidate = subCandidates.find((player) => player.playerId === incomingPlayerId) || null;
  const substitutionRetainsPitcher = currentSubPosition !== 'P' || !subDefensivePosition || subDefensivePosition === 'P';
  const substitutionWithinDefenseLimit = Boolean(
    !subDefensivePosition || currentSubPosition || Object.keys(snapshot.defense[subSide]).length < maximumDefensiveAssignments
  );
  const dpLineup = snapshot.lineups[dpSide];
  const dpCandidates = [...snapshot.availablePlayers[dpSide], ...dpLineup].filter(
    (player, index, all) => all.findIndex((candidate) => candidate.playerId === player.playerId) === index
  );
  const effectiveCourtesyRole: 'pitcher' | 'catcher' = snapshot.ruleCapabilities.courtesyRunner[courtesyRole]
    ? courtesyRole
    : snapshot.ruleCapabilities.courtesyRunner.pitcher
      ? 'pitcher'
      : 'catcher';
  const courtesyPosition = effectiveCourtesyRole === 'pitcher' ? 'P' : 'C';
  const courtesyPlayerId = snapshot.defense[battingSide][courtesyPosition]?.playerId || '';
  const courtesyEligiblePlacements = occupiedBases.filter((entry) => entry.runner.playerId === courtesyPlayerId);
  const courtesyPlacement =
    courtesyEligiblePlacements.find((entry) => entry.base === courtesyBase) || courtesyEligiblePlacements[0] || null;
  const occupiedIds = new Set(occupiedBases.map((entry) => entry.runner.playerId));
  const courtesyCandidates = snapshot.availablePlayers[battingSide].filter((player) => !occupiedIds.has(player.playerId));
  const canUseCourtesy = snapshot.ruleCapabilities.courtesyRunner[effectiveCourtesyRole];
  const structuredEvent = attachableEvents.find((event) => event.sourceEventId === structuredPlayId) || null;
  const structuredRequiresHomeRunRbi = Boolean(
    structuredEvent?.effectiveType === 'record_plate_appearance' && readString(structuredEvent.effectivePayload.result) === 'home_run'
  );
  useEffect(() => {
    if (structuredRequiresHomeRunRbi && judgmentRbi === 'no') setJudgmentRbi('yes');
  }, [judgmentRbi, structuredRequiresHomeRunRbi]);
  const structuredBattingSide = structuredEvent ? structuredEventBattingSide(snapshot, structuredEvent) : null;
  const structuredFieldingSide = structuredBattingSide ? oppositeDiamondSide(structuredBattingSide) : null;
  const structuredBattingPlayers = structuredBattingSide ? snapshotSidePlayers(snapshot, structuredBattingSide) : [];
  const structuredFieldingPlayers = structuredFieldingSide ? snapshotSidePlayers(snapshot, structuredFieldingSide) : [];
  const runnerDestinationOptions = activeRunner
    ? destinationOptions.filter(
        (option) => canChooseDestination(activeRunner.base, option.value) && canChooseRunnerCauseDestination(runnerAction, option.value)
      )
    : [];
  const resolvedRunnerDestination = runnerDestinationOptions.some((option) => option.value === runnerDestination)
    ? runnerDestination
    : runnerDestinationOptions[0]?.value;
  const requiredRunnerOutKind = requiredRunnerOutKinds.get(runnerAction);
  const runnerOutKindOptions = requiredRunnerOutKind
    ? outKindOptions.filter((option) => option.value === requiredRunnerOutKind)
    : outKindOptions;
  const resolvedRunnerOutKind = requiredRunnerOutKind || runnerOutKind;

  const reviewRunnerEvent = () => {
    if (!activeRunner || !resolvedRunnerDestination) return;
    const to = resolvedRunnerDestination;
    onReview('advance_runner', runnerAction.replace(/_/g, ' '), {
      runnerId: activeRunner.runner.playerId,
      from: activeRunner.base,
      to,
      cause: runnerAction,
      ...(to === 'out' ? { outKind: resolvedRunnerOutKind } : {}),
      ...(to === 'home'
        ? {
            countsRun: runnerCountsRun,
            rbi: runnerRbi,
            ...(runnerEarned ? { earned: runnerEarned === 'earned' } : {})
          }
        : {}),
      omissions: ['fielding', 'situational']
    });
  };

  const reviewStructured = () => {
    try {
      if (!structuredPlayId || !attachableEvents.some((event) => event.sourceEventId === structuredPlayId)) {
        throw new Error('Choose a play from complete private history.');
      }
      if (structuredType === 'record_fielding') {
        const assists = [fieldingAssistOne, fieldingAssistTwo].filter(Boolean);
        const fieldingPlayerIds = new Set(structuredFieldingPlayers.map((player) => player.playerId));
        if (
          [fieldingPutout, ...assists, fieldingErrorPlayer, fieldingPassedBall]
            .filter(Boolean)
            .some((playerId) => !fieldingPlayerIds.has(playerId))
        ) {
          throw new Error('Choose fielders from the selected play’s fielding side.');
        }
        const fielding: DiamondJsonObject = {
          ...(fieldingPutout ? { putoutBy: fieldingPutout } : {}),
          ...(assists.length ? { assists } : {}),
          ...(fieldingErrorPlayer ? { errors: [{ playerId: fieldingErrorPlayer, kind: fieldingErrorKind }] } : {}),
          ...(fieldingPassedBall ? { passedBallBy: fieldingPassedBall } : {}),
          ...(fieldingDoublePlay ? { doublePlay: true } : {}),
          ...(fieldingTriplePlay ? { triplePlay: true } : {}),
          ...(fieldingBattedBall !== 'unknown' ? { battedBall: fieldingBattedBall } : {}),
          ...(fieldingLocation.trim() ? { location: fieldingLocation.replace(/\s+/g, ' ').trim() } : {})
        };
        if (!Object.keys(fielding).length) {
          throw new Error('Enter at least one fielding detail; never guess an omitted value.');
        }
        setStructuredError('');
        onReview('record_fielding', 'fielding detail', { playEventId: structuredPlayId, fielding });
        return;
      }
      if (judgmentRunnerId && !structuredBattingPlayers.some((player) => player.playerId === judgmentRunnerId)) {
        throw new Error('Choose a runner from the selected play’s batting side.');
      }
      if (judgmentPitcherId && !structuredFieldingPlayers.some((player) => player.playerId === judgmentPitcherId)) {
        throw new Error('Choose a responsible pitcher from the selected play’s fielding side.');
      }
      const judgment: DiamondJsonObject = {
        playEventId: structuredPlayId,
        ...(judgmentRunnerId ? { runnerId: judgmentRunnerId } : {}),
        ...(judgmentEarned ? { earned: judgmentEarned === 'yes' } : {}),
        ...(judgmentRbi ? { rbi: structuredRequiresHomeRunRbi || judgmentRbi === 'yes' } : {}),
        ...(judgmentPitcherId ? { responsiblePitcherId: judgmentPitcherId } : {}),
        ...(pitcherDecision && pitcherDecisionPlayerId
          ? { pitcherOfRecord: { side: pitcherDecisionSide, playerId: pitcherDecisionPlayerId, decision: pitcherDecision } }
          : {})
      };
      if (Object.keys(judgment).length === 1) throw new Error('Enter at least one explicit scoring judgment.');
      setStructuredError('');
      onReview('record_scoring_judgment', 'scoring judgment', judgment);
    } catch (error) {
      setStructuredError(describeError(error, 'Review the command details.'));
    }
  };

  return (
    <details className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-3">
      <summary className="cursor-pointer text-sm font-black text-violet-950">Full-mode advanced plays</summary>
      <p className="mt-2 text-xs leading-5 font-semibold text-violet-900">
        These controls still open a final review. Missing fielding or situational detail is marked partial—not guessed.
      </p>

      <fieldset className="mt-4 rounded-xl border border-violet-200 bg-white p-3">
        <legend className="px-1 text-xs font-black text-gray-800">Runner-only play</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[11px] font-black text-gray-600">
            Runner
            <select
              className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
              value={activeRunner?.base || ''}
              disabled={disabled || !occupiedBases.length || snapshot.lifecycle !== 'active'}
              onChange={(event) => {
                const base = event.target.value as typeof runnerBase;
                setRunnerBase(base);
                setRunnerDestination(base === 'first' ? 'second' : base === 'second' ? 'third' : 'home');
              }}
            >
              {!occupiedBases.length ? <option value="">No runners on base</option> : null}
              {occupiedBases.map(({ base, runner }) => (
                <option key={base} value={base}>
                  {base} · {playerLabel(runner)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-black text-gray-600">
            Event
            <select
              className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
              value={runnerAction}
              disabled={disabled || snapshot.lifecycle !== 'active'}
              onChange={(event) => setRunnerAction(event.target.value as DiamondRunnerAdvanceCause)}
            >
              {runnerCauseOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-black text-gray-600">
            Destination
            <select
              className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
              value={resolvedRunnerDestination || ''}
              disabled={disabled || !activeRunner || snapshot.lifecycle !== 'active'}
              onChange={(event) => setRunnerDestination(event.target.value as RunnerDestination)}
            >
              {runnerDestinationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {resolvedRunnerDestination === 'out' ? (
            <label className="text-[11px] font-black text-gray-600">
              Out kind
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
                value={resolvedRunnerOutKind}
                disabled={disabled || snapshot.lifecycle !== 'active'}
                onChange={(event) => setRunnerOutKind(event.target.value as DiamondOutKind)}
              >
                {runnerOutKindOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {resolvedRunnerDestination === 'home' ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-3 text-xs font-black text-gray-700">
              <input
                type="checkbox"
                checked={runnerCountsRun}
                disabled={disabled}
                onChange={(event) => setRunnerCountsRun(event.target.checked)}
              />
              Run counts
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-3 text-xs font-black text-gray-700">
              <input
                type="checkbox"
                checked={runnerRbi}
                disabled={disabled || !runnerCountsRun}
                onChange={(event) => setRunnerRbi(event.target.checked)}
              />
              Credit RBI
            </label>
            <label className="text-[11px] font-black text-gray-600">
              Run charge
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
                value={runnerEarned}
                disabled={disabled}
                onChange={(event) => setRunnerEarned(event.target.value as typeof runnerEarned)}
              >
                <option value="">Not entered</option>
                <option value="earned">Earned</option>
                <option value="unearned">Unearned</option>
              </select>
            </label>
          </div>
        ) : null}
        <button
          type="button"
          className="ghost-button mt-2 w-full justify-center text-xs"
          disabled={disabled || !activeRunner || snapshot.lifecycle !== 'active'}
          onClick={reviewRunnerEvent}
        >
          Review runner event
        </button>
      </fieldset>

      <fieldset className="mt-3 rounded-xl border border-violet-200 bg-white p-3">
        <legend className="px-1 text-xs font-black text-gray-800">Substitution</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[11px] font-black text-gray-600">
            Side
            <select
              className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
              value={subSide}
              disabled={disabled || snapshot.lifecycle !== 'active'}
              onChange={(event) => {
                setSubSide(event.target.value as DiamondSide);
                setSubSlot('1');
                setIncomingPlayerId('');
                setSubDefensivePosition('');
              }}
            >
              <option value="away">Away</option>
              <option value="home">Home</option>
            </select>
          </label>
          <label className="text-[11px] font-black text-gray-600">
            Batting slot
            <select
              className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
              value={subEntry?.slot || ''}
              disabled={disabled || !subLineup.length || snapshot.lifecycle !== 'active'}
              onChange={(event) => {
                setSubSlot(event.target.value);
                setSubDefensivePosition('');
              }}
            >
              {subLineup.map((entry) => (
                <option key={entry.slot} value={entry.slot}>
                  {entry.slot} · {playerLabel(entry)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-black text-gray-600">
            Incoming
            <select
              className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
              value={incomingPlayerId}
              disabled={disabled || !subCandidates.length || snapshot.lifecycle !== 'active'}
              onChange={(event) => setIncomingPlayerId(event.target.value)}
            >
              <option value="">Choose player</option>
              {subCandidates.map((player) => (
                <option key={player.playerId} value={player.playerId}>
                  {playerLabel(player)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-black text-gray-600">
            Defensive assignment
            <select
              className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
              value={subDefensivePosition}
              disabled={disabled || snapshot.lifecycle !== 'active'}
              onChange={(event) => setSubDefensivePosition(event.target.value as DiamondDefensivePosition | '')}
            >
              <option value="">{currentSubPosition ? `Replace at ${currentSubPosition}` : 'Batting only'}</option>
              {defensivePositions
                .filter((position) => currentSubPosition !== 'P' || position === 'P')
                .map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            className="ghost-button w-full justify-center text-xs"
            disabled={
              disabled ||
              snapshot.lifecycle !== 'active' ||
              !subEntry ||
              !incomingSubCandidate ||
              !substitutionRetainsPitcher ||
              !substitutionWithinDefenseLimit
            }
            onClick={() =>
              subEntry &&
              incomingSubCandidate &&
              onReview('substitute', 'substitution', {
                side: subSide,
                battingSlot: subEntry.slot,
                outgoingPlayerId: subEntry.playerId,
                incomingPlayerId: incomingSubCandidate.playerId,
                ...(subDefensivePosition ? { defensivePosition: subDefensivePosition } : {})
              })
            }
          >
            Review substitution
          </button>
          <button
            type="button"
            className="ghost-button w-full justify-center text-xs"
            disabled={
              disabled ||
              snapshot.lifecycle !== 'active' ||
              !subEntry ||
              !reentryAvailable ||
              !substitutionRetainsPitcher ||
              !substitutionWithinDefenseLimit
            }
            onClick={() =>
              subEntry?.starterPlayerId &&
              onReview('re_enter', 'starter re-entry', {
                side: subSide,
                battingSlot: subEntry.slot,
                starterPlayerId: subEntry.starterPlayerId,
                replacedPlayerId: subEntry.playerId,
                ...(subDefensivePosition ? { defensivePosition: subDefensivePosition } : {})
              })
            }
          >
            Review starter re-entry
          </button>
        </div>
        {!substitutionWithinDefenseLimit ? (
          <p className="mt-2 text-[11px] font-semibold text-amber-800">
            A full ten-player defense requires replacing a current defender or keeping this substitution batting-only.
          </p>
        ) : null}
        {subEntry && subEntry.starterPlayerId !== subEntry.playerId ? (
          <p className="mt-2 text-[11px] font-semibold text-gray-600">
            Starter {subEntry.starterPlayerId} · re-entries used {subEntry.starterReentriesUsed || 0}
            {reentryAvailable ? '' : ' · no verified re-entry remains'}
          </p>
        ) : null}
      </fieldset>

      {snapshot.lifecycle === 'ready' && snapshot.ruleCapabilities.dpFlex && rulesProfile?.dpFlex.enabled ? (
        <fieldset className="mt-3 rounded-xl border border-violet-200 bg-white p-3">
          <legend className="px-1 text-xs font-black text-gray-800">Fastpitch DP/FLEX</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[11px] font-black text-gray-600">
              Side
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
                value={dpSide}
                disabled={disabled}
                onChange={(event) => {
                  setDpSide(event.target.value as DiamondSide);
                  setDpPlayerId('');
                  setFlexPlayerId('');
                }}
              >
                <option value="away">Away</option>
                <option value="home">Home</option>
              </select>
            </label>
            <label className="text-[11px] font-black text-gray-600">
              DP in batting order
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
                value={dpPlayerId}
                disabled={disabled || !dpLineup.length}
                onChange={(event) => setDpPlayerId(event.target.value)}
              >
                <option value="">Choose DP</option>
                {dpLineup.map((player) => (
                  <option key={player.playerId} value={player.playerId}>
                    {playerLabel(player)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-black text-gray-600">
              FLEX player
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
                value={flexPlayerId}
                disabled={disabled}
                onChange={(event) => setFlexPlayerId(event.target.value)}
              >
                <option value="">Choose FLEX</option>
                {dpCandidates
                  .filter((player) => player.playerId !== dpPlayerId)
                  .map((player) => (
                    <option key={player.playerId} value={player.playerId}>
                      {playerLabel(player)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-[11px] font-black text-gray-600">
              FLEX position
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
                value={dpPosition}
                disabled={disabled}
                onChange={(event) => setDpPosition(event.target.value as typeof dpPosition)}
              >
                {defensivePositions.map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="ghost-button mt-2 w-full justify-center text-xs"
            disabled={disabled || !dpPlayerId || !flexPlayerId}
            onClick={() => {
              const dp = dpLineup.find((entry) => entry.playerId === dpPlayerId);
              if (dp)
                onReview('set_dp_flex', 'DP/FLEX assignment', {
                  side: dpSide,
                  dpPlayerId,
                  flexPlayerId,
                  dpBattingSlot: dp.slot,
                  flexDefensivePosition: dpPosition
                });
            }}
          >
            Review DP/FLEX
          </button>
        </fieldset>
      ) : null}

      {snapshot.ruleCapabilities.courtesyRunner.pitcher || snapshot.ruleCapabilities.courtesyRunner.catcher ? (
        <fieldset className="mt-3 rounded-xl border border-violet-200 bg-white p-3">
          <legend className="px-1 text-xs font-black text-gray-800">Courtesy runner</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-[11px] font-black text-gray-600">
              Occupied base
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
                value={courtesyPlacement?.base || ''}
                disabled={disabled || !courtesyEligiblePlacements.length || snapshot.lifecycle !== 'active'}
                onChange={(event) => setCourtesyBase(event.target.value as typeof courtesyBase)}
              >
                {!courtesyEligiblePlacements.length ? <option value="">Recorded {courtesyPosition} is not on base</option> : null}
                {courtesyEligiblePlacements.map(({ base, runner }) => (
                  <option key={base} value={base}>
                    {base} · {playerLabel(runner)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-black text-gray-600">
              For role
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
                value={effectiveCourtesyRole}
                disabled={disabled || snapshot.lifecycle !== 'active'}
                onChange={(event) => setCourtesyRole(event.target.value as typeof courtesyRole)}
              >
                <option value="pitcher" disabled={!snapshot.ruleCapabilities.courtesyRunner.pitcher}>
                  Pitcher
                </option>
                <option value="catcher" disabled={!snapshot.ruleCapabilities.courtesyRunner.catcher}>
                  Catcher
                </option>
              </select>
            </label>
            <label className="text-[11px] font-black text-gray-600">
              Runner
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
                value={courtesyRunnerId}
                disabled={disabled || !courtesyCandidates.length || snapshot.lifecycle !== 'active'}
                onChange={(event) => setCourtesyRunnerId(event.target.value)}
              >
                <option value="">Choose player</option>
                {courtesyCandidates.map((player) => (
                  <option key={player.playerId} value={player.playerId}>
                    {playerLabel(player)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="ghost-button mt-2 w-full justify-center text-xs"
            disabled={disabled || snapshot.lifecycle !== 'active' || !courtesyPlacement || !courtesyRunnerId || !canUseCourtesy}
            onClick={() =>
              courtesyPlacement &&
              onReview('add_courtesy_runner', 'courtesy runner', {
                side: battingSide,
                forPlayerId: courtesyPlacement.runner.playerId,
                runnerId: courtesyRunnerId,
                base: courtesyPlacement.base,
                forRole: effectiveCourtesyRole
              })
            }
          >
            Review courtesy runner
          </button>
        </fieldset>
      ) : null}

      <fieldset className="mt-3 rounded-xl border border-violet-200 bg-white p-3">
        <legend className="px-1 text-xs font-black text-gray-800">Suspend scoring</legend>
        <label className="text-[11px] font-black text-gray-600">
          Reason
          <input
            className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold"
            value={suspendReason}
            maxLength={300}
            disabled={disabled || snapshot.lifecycle !== 'active'}
            onChange={(event) => setSuspendReason(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="ghost-button mt-2 w-full justify-center text-xs"
          disabled={disabled || snapshot.lifecycle !== 'active' || !suspendReason.trim()}
          onClick={() => onReview('suspend', 'suspend game', { reason: suspendReason.trim() })}
        >
          Review suspension
        </button>
      </fieldset>

      <fieldset className="mt-3 rounded-xl border border-violet-200 bg-white p-3">
        <legend className="px-1 text-xs font-black text-gray-800">Structured fielding or scoring judgment</legend>
        <p className="text-[11px] leading-5 font-semibold text-gray-600">
          Attach observed detail to an exact effective play. The verified window reaches the current revision, so later correction
          directives are applied before a loaded play can be targeted. Load older blocks to find earlier plays.
        </p>
        {!historyLoaded ? (
          <button
            type="button"
            className="ghost-button mt-2 w-full justify-center text-xs"
            disabled={historyLoading}
            onClick={onLoadHistory}
          >
            {historyLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
            )}
            Load exact play targets
          </button>
        ) : null}
        <label className="mt-2 block text-[11px] font-black text-gray-600">
          Effective play
          <select
            className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
            value={structuredPlayId}
            disabled={disabled || !attachableEvents.length || !['active', 'correction'].includes(snapshot.lifecycle)}
            onChange={(event) => setStructuredPlayId(event.target.value)}
          >
            {!attachableEvents.length ? <option value="">No verified play targets loaded</option> : null}
            {attachableEvents
              .slice(-50)
              .reverse()
              .map((event) => (
                <option key={event.sourceEventId} value={event.sourceEventId}>
                  {privateEventLabel(event)}
                </option>
              ))}
          </select>
        </label>
        <select
          aria-label="Structured command type"
          className="mt-2 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
          value={structuredType}
          disabled={disabled || !['active', 'correction'].includes(snapshot.lifecycle)}
          onChange={(event) => {
            setStructuredType(event.target.value as typeof structuredType);
            setStructuredError('');
          }}
        >
          <option value="record_fielding">Fielding detail</option>
          <option value="record_scoring_judgment">Scoring judgment</option>
        </select>
        {structuredType === 'record_fielding' ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <FielderSelect
              label="Putout"
              value={fieldingPutout}
              players={structuredFieldingPlayers}
              disabled={disabled}
              onChange={setFieldingPutout}
            />
            <FielderSelect
              label="First assist"
              value={fieldingAssistOne}
              players={structuredFieldingPlayers}
              disabled={disabled}
              onChange={setFieldingAssistOne}
            />
            <FielderSelect
              label="Second assist"
              value={fieldingAssistTwo}
              players={structuredFieldingPlayers}
              disabled={disabled}
              onChange={setFieldingAssistTwo}
            />
            <FielderSelect
              label="Error charged to"
              value={fieldingErrorPlayer}
              players={structuredFieldingPlayers}
              disabled={disabled}
              onChange={setFieldingErrorPlayer}
            />
            {fieldingErrorPlayer ? (
              <label className="text-xs font-black text-gray-700">
                Error kind
                <select
                  className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
                  value={fieldingErrorKind}
                  disabled={disabled}
                  onChange={(event) => setFieldingErrorKind(event.target.value as typeof fieldingErrorKind)}
                >
                  <option value="fielding">Fielding</option>
                  <option value="throwing">Throwing</option>
                </select>
              </label>
            ) : null}
            <FielderSelect
              label="Passed ball charged to"
              value={fieldingPassedBall}
              players={structuredFieldingPlayers}
              disabled={disabled}
              onChange={setFieldingPassedBall}
            />
            <label className="text-xs font-black text-gray-700">
              Batted ball
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
                value={fieldingBattedBall}
                disabled={disabled}
                onChange={(event) => setFieldingBattedBall(event.target.value as typeof fieldingBattedBall)}
              >
                <option value="unknown">Not entered</option>
                <option value="ground">Ground</option>
                <option value="line">Line</option>
                <option value="fly">Fly</option>
                <option value="bunt">Bunt</option>
              </select>
            </label>
            <label className="text-xs font-black text-gray-700">
              Location
              <input
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold"
                value={fieldingLocation}
                maxLength={80}
                disabled={disabled}
                onChange={(event) => setFieldingLocation(event.target.value)}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-3 text-xs font-black text-gray-700">
              <input
                type="checkbox"
                checked={fieldingDoublePlay}
                disabled={disabled || fieldingTriplePlay}
                onChange={(event) => setFieldingDoublePlay(event.target.checked)}
              />{' '}
              Double play
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-3 text-xs font-black text-gray-700">
              <input
                type="checkbox"
                checked={fieldingTriplePlay}
                disabled={disabled || fieldingDoublePlay}
                onChange={(event) => setFieldingTriplePlay(event.target.checked)}
              />{' '}
              Triple play
            </label>
          </div>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-black text-gray-700">
              Runner (optional)
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
                value={judgmentRunnerId}
                disabled={disabled}
                onChange={(event) => setJudgmentRunnerId(event.target.value)}
              >
                <option value="">Play-level judgment</option>
                {structuredBattingPlayers.map((player) => (
                  <option key={player.playerId} value={player.playerId}>
                    {playerLabel(player)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-black text-gray-700">
              Earned run
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
                value={judgmentEarned}
                disabled={disabled}
                onChange={(event) => setJudgmentEarned(event.target.value as typeof judgmentEarned)}
              >
                <option value="">Not entered</option>
                <option value="yes">Earned</option>
                <option value="no">Unearned</option>
              </select>
            </label>
            <label className="text-xs font-black text-gray-700">
              RBI
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
                value={judgmentRbi}
                disabled={disabled}
                onChange={(event) => setJudgmentRbi(event.target.value as typeof judgmentRbi)}
              >
                <option value="">Not entered</option>
                <option value="yes">Credit RBI</option>
                <option value="no" disabled={structuredRequiresHomeRunRbi}>
                  No RBI
                </option>
              </select>
            </label>
            <FielderSelect
              label="Responsible pitcher"
              value={judgmentPitcherId}
              players={structuredFieldingPlayers}
              disabled={disabled}
              onChange={setJudgmentPitcherId}
            />
            <label className="text-xs font-black text-gray-700">
              Pitcher decision
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
                value={pitcherDecision}
                disabled={disabled}
                onChange={(event) => setPitcherDecision(event.target.value as typeof pitcherDecision)}
              >
                <option value="">None</option>
                <option value="win">Win</option>
                <option value="loss">Loss</option>
                <option value="save">Save</option>
              </select>
            </label>
            {pitcherDecision ? (
              <>
                <label className="text-xs font-black text-gray-700">
                  Decision side
                  <select
                    className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
                    value={pitcherDecisionSide}
                    disabled={disabled}
                    onChange={(event) => {
                      setPitcherDecisionSide(event.target.value as DiamondSide);
                      setPitcherDecisionPlayerId('');
                    }}
                  >
                    <option value="away">Away</option>
                    <option value="home">Home</option>
                  </select>
                </label>
                <label className="text-xs font-black text-gray-700">
                  Decision pitcher
                  <select
                    className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
                    value={pitcherDecisionPlayerId}
                    disabled={disabled}
                    onChange={(event) => setPitcherDecisionPlayerId(event.target.value)}
                  >
                    <option value="">Choose pitcher</option>
                    {snapshot.availablePlayers[pitcherDecisionSide].map((player) => (
                      <option key={player.playerId} value={player.playerId}>
                        {playerLabel(player)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>
        )}
        {structuredError ? (
          <div className="mt-2 text-xs font-bold text-rose-700" role="alert">
            {structuredError}
          </div>
        ) : null}
        <button
          type="button"
          className="ghost-button mt-2 w-full justify-center text-xs"
          disabled={disabled || !structuredPlayId || !['active', 'correction'].includes(snapshot.lifecycle)}
          onClick={reviewStructured}
        >
          Review {structuredType === 'record_fielding' ? 'fielding detail' : 'scoring judgment'}
        </button>
      </fieldset>
    </details>
  );
}

function ScoreSide({ name, score, align }: { name: string; score: number; align: 'left' | 'right' }) {
  return (
    <div className={align === 'right' ? 'text-right' : 'text-left'}>
      <div className="truncate text-xs font-black tracking-wide text-emerald-200 uppercase">{name}</div>
      <div className="mt-0.5 text-4xl font-black tabular-nums">{score}</div>
    </div>
  );
}

function PlayerContext({ label, player }: { label: string; player: DiamondPlayerRef | null }) {
  return (
    <div className="min-w-0 p-3">
      <div className="text-[10px] font-black tracking-wider text-gray-500 uppercase">{label}</div>
      <div className="mt-1 truncate text-sm font-black text-gray-950">{playerLabel(player)}</div>
    </div>
  );
}

function BaseDiamond({ snapshot }: { snapshot: DiamondScorebookSnapshot }) {
  return (
    <div className="relative mx-auto h-48 max-w-sm" role="group" aria-label="Base runners">
      <div
        className="absolute inset-x-0 bottom-3 mx-auto h-36 w-36 rotate-45 rounded-2xl border-2 border-emerald-200 bg-emerald-50"
        aria-hidden="true"
      />
      <BaseMarker className="top-3 left-1/2 -translate-x-1/2" base="Second" runner={snapshot.bases.second} />
      <BaseMarker className="top-1/2 right-[12%] -translate-y-1/2" base="First" runner={snapshot.bases.first} />
      <BaseMarker className="top-1/2 left-[12%] -translate-y-1/2" base="Third" runner={snapshot.bases.third} />
      <div className="absolute bottom-2 left-1/2 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-xl border-2 border-gray-200 bg-white text-[10px] font-black text-gray-500 uppercase shadow-sm">
        Home
      </div>
    </div>
  );
}

function BaseMarker({ className, base, runner }: { className: string; base: string; runner: DiamondPlayerRef | null }) {
  return (
    <div
      className={`absolute z-10 flex h-14 w-20 flex-col items-center justify-center rounded-xl border-2 text-center shadow-sm ${className} ${runner ? 'border-amber-300 bg-amber-100 text-amber-950' : 'border-gray-200 bg-white text-gray-500'}`}
      aria-label={`${base} base: ${runner ? playerLabel(runner) : 'empty'}`}
    >
      <span className="text-[9px] font-black tracking-wide uppercase">{base}</span>
      <span className="mt-0.5 max-w-full truncate px-1 text-[11px] font-black">{runner ? playerLabel(runner) : 'Empty'}</span>
    </div>
  );
}

function NoticeCard({ notice }: { notice: Notice }) {
  const classes =
    notice.tone === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-900'
      : notice.tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : 'border-sky-200 bg-sky-50 text-sky-900';
  return (
    <div
      className={`rounded-xl border px-3 py-2 text-sm leading-5 font-semibold ${classes}`}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      {notice.message}
    </div>
  );
}

function CompletenessCard({ snapshot }: { snapshot: DiamondScorebookSnapshot }) {
  const families = Object.entries(snapshot.completeness.families);
  return (
    <section className="app-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CircleDot className="text-primary-600 h-5 w-5" aria-hidden="true" />
          <h2 className="text-sm font-black text-gray-950">Stat coverage</h2>
        </div>
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-black tracking-wide text-gray-700 uppercase">
          {snapshot.completeness.status.replace(/_/g, ' ')} · revision {snapshot.completeness.authoritativeRevision}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {families.length ? (
          families.map(([family, status]) => (
            <span
              key={family}
              className={`rounded-full border px-2 py-1 text-[10px] font-black tracking-wide uppercase ${status === 'complete' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : status === 'not_collected' ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
            >
              {family.replace(/_/g, ' ')} · {status.replace(/_/g, ' ')}
            </span>
          ))
        ) : (
          <span className="text-xs font-semibold text-amber-800">Coverage evidence is incomplete.</span>
        )}
      </div>
      <p className="mt-3 text-xs leading-5 font-semibold text-gray-600">
        Missing capture is labeled partial or not collected; it is never converted to zero.
      </p>
      {snapshot.completeness.omissions.length ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
          <div className="font-black">Known omissions</div>
          <ul className="mt-1 list-disc space-y-1 pl-4 font-semibold">
            {snapshot.completeness.omissions.slice(0, 20).map((omission) => (
              <li key={omission}>{omission}</li>
            ))}
          </ul>
          {snapshot.completeness.omissions.length > 20 ? (
            <div className="mt-2 font-bold">{snapshot.completeness.omissions.length - 20} more omissions are recorded.</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PlayReviewModal({
  pending,
  snapshot,
  controlMode,
  busy,
  onChange,
  onClose,
  onConfirm
}: {
  pending: PendingPlay;
  snapshot: DiamondScorebookSnapshot;
  controlMode: DiamondCaptureMode;
  busy: boolean;
  onChange: (pending: PendingPlay) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const validationError = validateRunnerReview(pending, snapshot) || validateSubstitutionPendingReview(pending);
  const correctionBattingSideValue =
    pending.correction && pending.batterId && pending.pitcherId
      ? correctionBattingSide(snapshot, pending.batterId, pending.pitcherId)
      : null;
  const reviewFieldingPlayers = pending.correction
    ? correctionBattingSideValue
      ? snapshotSidePlayers(snapshot, oppositeDiamondSide(correctionBattingSideValue))
      : []
    : snapshot.defensiveLineup;
  const activeDefenseName = pending.activeDefenseSource
    ? pending.activeDefenseSource.side === 'home'
      ? snapshot.homeName
      : snapshot.awayName
    : '';
  const activeDefenseAssignments =
    pending.activeDefenseSource && Array.isArray(pending.payload.assignments)
      ? pending.payload.assignments.flatMap((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
          const position = 'position' in entry ? entry.position : null;
          const playerId = 'playerId' in entry ? entry.playerId : null;
          return typeof position === 'string' && typeof playerId === 'string' ? [{ position, playerId }] : [];
        })
      : [];
  const substitutionTransfer = pending.substitutionSource?.transferBase
    ? {
        base: pending.substitutionSource.transferBase,
        outgoing: snapshotSidePlayer(snapshot, pending.substitutionSource.side, pending.substitutionSource.outgoingPlayerId),
        incoming: snapshotSidePlayer(snapshot, pending.substitutionSource.side, pending.substitutionSource.incomingPlayerId)
      }
    : null;
  const setOutcome = (result: string) => {
    const option = outcomeOptions.find((candidate) => candidate.result === result);
    if (!option) return;
    const next = pending.correction ? retargetCorrectionOutcome(pending, option) : buildPendingOutcome(snapshot, option, pending.source);
    onChange({
      ...next,
      unresolvedFields: pending.unresolvedFields,
      ambiguityConfirmed: pending.ambiguityConfirmed,
      aiConfidence: pending.aiConfidence,
      sourceRevision: pending.sourceRevision,
      ...(pending.plateAppearanceSource ? { plateAppearanceSource: pending.plateAppearanceSource } : {})
    });
  };
  const updateRunnerMove = (key: string, updates: Partial<RunnerMoveDraft>) => {
    const runnerMoves = forceHomeRunRbis(
      pending.result,
      pending.runnerMoves.map((move) => (move.key === key ? { ...move, ...updates } : move))
    );
    onChange({
      ...pending,
      runnerMoves,
      outsOnPlay: runnerMoves.filter((move) => move.to === 'out').length,
      runsBattedIn: runnerMoves.filter((move) => move.to === 'home' && move.countsRun !== false && move.rbi).length
    });
  };
  return (
    <Modal
      onClose={onClose}
      ariaLabelledBy="diamond-play-review-title"
      overlayClassName="z-50 flex items-end justify-center bg-gray-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <section className="shadow-app-lg max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-3xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-primary-600 text-[10px] font-black tracking-widest uppercase">
              {pending.source === 'voice' ? 'AI draft · confirmation required' : 'Atomic play review'}
            </div>
            <h2 id="diamond-play-review-title" className="mt-1 text-xl font-black text-gray-950">
              Review {pending.label}
            </h2>
            <p className="mt-1 text-xs leading-5 font-semibold text-gray-600">
              Nothing is recorded until you confirm. Any uncollected detail remains explicitly partial.
            </p>
          </div>
          <button type="button" className="ghost-button !h-10 !min-h-10 !w-10 !p-0" onClick={onClose} aria-label="Close play review">
            ×
          </button>
        </div>

        {pending.source === 'voice' ? (
          <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs leading-5 font-semibold text-violet-900">
            <div className="flex items-center gap-2 font-black">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              AI can be wrong.
            </div>
            {pending.aiConfidence !== null ? (
              <div className="mt-1 font-black">AI confidence: {Math.round(pending.aiConfidence * 100)}%</div>
            ) : null}
            Check the result, every runner, and every out. The deterministic scorebook—not AI—becomes official only after confirmation.
          </div>
        ) : null}

        {pending.unresolvedFields.length ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-950">
            <div className="font-black">Unresolved: {pending.unresolvedFields.join(', ')}</div>
            <label className="mt-2 flex min-h-10 items-center gap-2">
              <input
                type="checkbox"
                checked={pending.ambiguityConfirmed}
                onChange={(event) => onChange({ ...pending, ambiguityConfirmed: event.target.checked })}
              />
              I verified these details against the play.
            </label>
          </div>
        ) : null}

        {pending.type === 'record_plate_appearance' ? (
          <>
            <label className="mt-4 block text-xs font-black text-gray-700" htmlFor="diamond-review-result">
              Play result
            </label>
            <select
              id="diamond-review-result"
              className="mt-1 min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-black text-gray-950"
              value={pending.result}
              onChange={(event) => setOutcome(event.target.value)}
            >
              {outcomeOptions
                .filter((option) => controlMode === 'full' || !option.fullOnly || option.result === pending.result)
                .map((option) => (
                  <option
                    key={option.result}
                    value={option.result}
                    disabled={!pending.correction && snapshot.inning.outs >= 2 && isSacrificeResult(option.result)}
                  >
                    {option.label}
                  </option>
                ))}
            </select>

            <fieldset className="mt-4">
              <legend className="text-xs font-black text-gray-700">Runner destinations</legend>
              <div className="mt-2 space-y-2">
                {pending.runnerMoves.map((move) => (
                  <fieldset key={move.key} className="rounded-xl border border-gray-200 p-3">
                    <legend className="px-1 text-sm font-black text-gray-900">{move.label}</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="text-[11px] font-black text-gray-700">
                        Destination
                        <select
                          aria-label={`${move.label} destination`}
                          className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm font-black"
                          value={move.to}
                          onChange={(event) => {
                            const to = event.target.value as RunnerDestination;
                            const cause = defaultRunnerCause(pending.result, to);
                            updateRunnerMove(move.key, {
                              to,
                              cause,
                              outKind: to === 'out' ? defaultOutKind(pending.result, move.from) : undefined,
                              countsRun: to === 'home' ? true : undefined,
                              rbi: to === 'home' ? defaultScoringAdvanceRbi(pending.result, cause) : undefined,
                              earned: to === 'home' ? move.earned : undefined,
                              responsiblePitcherId:
                                to === 'home'
                                  ? move.responsiblePitcherId || (pending.correction ? undefined : snapshot.currentPitcher?.playerId)
                                  : undefined
                            });
                          }}
                        >
                          {destinationOptions
                            .filter(
                              (option) =>
                                canChooseDestination(move.from, option.value) &&
                                (move.from !== 'batter' || canChooseBatterDestination(pending.result, option.value))
                            )
                            .map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="text-[11px] font-black text-gray-700">
                        Advance cause
                        <select
                          aria-label={`${move.label} cause`}
                          className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm font-bold"
                          value={move.cause}
                          onChange={(event) => {
                            const cause = event.target.value as DiamondRunnerAdvanceCause;
                            const requiredOutKind =
                              move.from === 'batter' ? diamondRequiredBatterAdvanceOutKind(cause) : requiredRunnerOutKinds.get(cause);
                            updateRunnerMove(move.key, {
                              cause,
                              ...(move.to === 'home'
                                ? {
                                    rbi: move.countsRun === true ? defaultScoringAdvanceRbi(pending.result, cause) : false
                                  }
                                : {}),
                              ...(move.to === 'out' && requiredOutKind ? { outKind: requiredOutKind } : {})
                            });
                          }}
                        >
                          {runnerCauseOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {move.to === 'out' ? (
                        <label className="text-[11px] font-black text-gray-700 sm:col-span-2">
                          Out kind
                          <select
                            aria-label={`${move.label} out kind`}
                            className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm font-bold"
                            value={move.outKind || ''}
                            onChange={(event) => updateRunnerMove(move.key, { outKind: event.target.value as DiamondOutKind })}
                          >
                            <option value="">Choose out kind</option>
                            {outKindOptions
                              .filter(
                                (option) =>
                                  !requiredReviewOutKind(pending.result, move) ||
                                  option.value === requiredReviewOutKind(pending.result, move)
                              )
                              .map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                          </select>
                        </label>
                      ) : null}
                      {move.to === 'home' ? (
                        <>
                          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-black text-gray-700">
                            <input
                              type="checkbox"
                              checked={move.countsRun === true}
                              onChange={(event) =>
                                updateRunnerMove(move.key, {
                                  countsRun: event.target.checked,
                                  rbi: event.target.checked ? defaultScoringAdvanceRbi(pending.result, move.cause) : false
                                })
                              }
                            />
                            Run counts
                          </label>
                          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-black text-gray-700">
                            <input
                              type="checkbox"
                              checked={reviewedMoveHasRbi(pending.result, move)}
                              disabled={move.countsRun !== true || requiresHomeRunRbi(pending.result, move)}
                              onChange={(event) => updateRunnerMove(move.key, { rbi: event.target.checked })}
                            />
                            Credit RBI
                          </label>
                          {controlMode === 'full' ? (
                            <label className="text-[11px] font-black text-gray-700 sm:col-span-2">
                              Run charge
                              <select
                                aria-label={`${move.label} run charge`}
                                className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm font-black"
                                value={move.earned === undefined ? '' : move.earned ? 'earned' : 'unearned'}
                                onChange={(event) =>
                                  updateRunnerMove(move.key, {
                                    earned: event.target.value === 'earned' ? true : event.target.value === 'unearned' ? false : undefined
                                  })
                                }
                              >
                                <option value="">Not entered</option>
                                <option value="earned">Earned</option>
                                <option value="unearned">Unearned</option>
                              </select>
                            </label>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </fieldset>
                ))}
              </div>
            </fieldset>

            {controlMode === 'full' && pending.runnerMoves.some((move) => move.to === 'home' && move.earned === undefined) ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-950">
                Choose earned or unearned for each run to keep pitching coverage complete. Leaving it unentered records the play but marks
                pitching stats partial.
              </div>
            ) : null}

            {controlMode === 'full' && pending.result === 'reached_on_error' && !pending.errorBy ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-950">
                Select the fielder charged with the error to keep fielding coverage complete. Leaving it unentered records the play but
                marks fielding stats partial.
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-3" aria-label="Play totals derived from runner decisions">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs font-black text-gray-700">
                Outs on play
                <output className="mt-1 block text-lg text-gray-950" aria-label="Outs on play">
                  {pending.outsOnPlay}
                </output>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs font-black text-gray-700">
                RBI credit
                <output className="mt-1 block text-lg text-gray-950" aria-label="RBI credit">
                  {pending.runsBattedIn}
                </output>
              </div>
            </div>

            {controlMode === 'full' ? (
              <fieldset className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <legend className="px-1 text-xs font-black text-gray-700">Fielding detail</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FielderSelect
                    label="Putout"
                    value={pending.putoutBy}
                    players={reviewFieldingPlayers}
                    onChange={(value) => onChange({ ...pending, putoutBy: value })}
                  />
                  <FielderSelect
                    label="Assist"
                    value={pending.assistBy}
                    players={reviewFieldingPlayers}
                    onChange={(value) => onChange({ ...pending, assistBy: value })}
                  />
                  <FielderSelect
                    label="Error"
                    value={pending.errorBy}
                    players={reviewFieldingPlayers}
                    onChange={(value) => onChange({ ...pending, errorBy: value })}
                  />
                  <label className="text-xs font-black text-gray-700">
                    Batted ball
                    <select
                      className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
                      value={pending.battedBall}
                      onChange={(event) => onChange({ ...pending, battedBall: event.target.value })}
                    >
                      <option value="unknown">Not entered</option>
                      <option value="ground">Ground</option>
                      <option value="line">Line</option>
                      <option value="fly">Fly</option>
                      <option value="bunt">Bunt</option>
                    </select>
                  </label>
                </div>
              </fieldset>
            ) : null}
          </>
        ) : pending.source === 'voice' ? (
          <details className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <summary className="cursor-pointer text-sm font-black text-amber-950">Advanced JSON fallback</summary>
            <p className="mt-2 text-xs leading-5 font-semibold text-amber-900">
              This proposal does not yet have a dedicated form. Use only if you understand the canonical command contract; ordinary controls
              remain available.
            </p>
            <label className="mt-3 block text-xs font-black text-gray-700" htmlFor="diamond-proposal-payload">
              Editable command details
            </label>
            <textarea
              id="diamond-proposal-payload"
              className="mt-1 min-h-32 w-full resize-y rounded-xl border border-gray-300 bg-white p-3 font-mono text-xs leading-5 text-gray-950"
              value={pending.payloadDraft}
              onChange={(event) => onChange({ ...pending, payloadDraft: event.target.value })}
              spellCheck={false}
            />
          </details>
        ) : pending.activeDefenseSource ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs font-black tracking-wide text-emerald-800 uppercase">Complete reviewed alignment</div>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2" aria-label={`Complete ${activeDefenseName} defensive alignment`}>
              {activeDefenseAssignments.map((assignment) => {
                const player = snapshotSidePlayer(snapshot, pending.activeDefenseSource!.side, assignment.playerId);
                return (
                  <li key={assignment.position} className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-black">
                    {assignment.position} · {player ? playerLabel(player) : assignment.playerId}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs leading-5 font-semibold text-emerald-900">
              This replaces the full on-field position map without changing batting order, substitution, or re-entry history.
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="text-xs font-black tracking-wide text-gray-500 uppercase">Confirmed fields</div>
            <dl className="mt-2 space-y-2">
              {Object.entries(pending.payload).map(([key, value]) => (
                <div key={key} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 text-xs">
                  <dt className="font-black text-gray-600">{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}</dt>
                  <dd className="font-semibold break-words text-gray-900">
                    {Array.isArray(value)
                      ? `${value.length} ${value.length === 1 ? 'entry' : 'entries'}`
                      : value && typeof value === 'object'
                        ? 'Structured detail included'
                        : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {substitutionTransfer ? (
          <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3" aria-label="Derived live-base transfer">
            <div className="text-xs font-black tracking-wide text-violet-800 uppercase">
              {`${substitutionTransfer.base[0]!.toUpperCase()}${substitutionTransfer.base.slice(1)}`} base transfer
            </div>
            <p className="mt-2 text-sm font-black text-violet-950">
              {substitutionTransfer.outgoing ? playerLabel(substitutionTransfer.outgoing) : pending.substitutionSource!.outgoingPlayerId}
              {' → '}
              {substitutionTransfer.incoming ? playerLabel(substitutionTransfer.incoming) : pending.substitutionSource!.incomingPlayerId}
            </p>
            <p className="mt-2 text-xs leading-5 font-semibold text-violet-900">
              The incoming player takes this live base. Pitcher responsibility, courtesy-runner identity, and reach-event evidence remain
              attached to the placement.
            </p>
          </div>
        ) : null}

        {validationError ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-900" role="alert">
            {validationError}
          </div>
        ) : null}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="ghost-button justify-center" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button justify-center"
            onClick={onConfirm}
            disabled={busy || Boolean(validationError) || !pending.ambiguityConfirmed}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            {pending.correction ? 'Confirm correction' : pending.type === 'record_plate_appearance' ? 'Confirm play' : 'Confirm action'}
          </button>
        </div>
      </section>
    </Modal>
  );
}

function FielderSelect({
  label,
  value,
  players,
  disabled = false,
  onChange
}: {
  label: string;
  value: string;
  players: DiamondPlayerRef[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-black text-gray-700">
      {label}
      <select
        className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Not entered</option>
        {players.map((player) => (
          <option key={player.playerId} value={player.playerId}>
            {playerLabel(player)}
          </option>
        ))}
      </select>
    </label>
  );
}

function VoiceModal({
  intent,
  draft,
  dictating,
  interpreting,
  savingNote,
  questions,
  confidence,
  online,
  canInterpret,
  attachToLastPlay,
  hasRecentPlay,
  onDraftChange,
  onIntentChange,
  onToggleDictation,
  onAttachChange,
  onInterpret,
  onSaveNote,
  onClose
}: {
  intent: 'play' | 'private-note';
  draft: string;
  dictating: boolean;
  interpreting: boolean;
  savingNote: boolean;
  questions: string[];
  confidence: number | null;
  online: boolean;
  canInterpret: boolean;
  attachToLastPlay: boolean;
  hasRecentPlay: boolean;
  onDraftChange: (value: string) => void;
  onIntentChange: (value: 'play' | 'private-note') => void;
  onToggleDictation: () => void;
  onAttachChange: (value: boolean) => void;
  onInterpret: () => void;
  onSaveNote: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      onClose={onClose}
      ariaLabelledBy="diamond-voice-title"
      overlayClassName="z-50 flex items-end justify-center bg-gray-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <section className="shadow-app-lg max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-3xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black tracking-widest text-violet-600 uppercase">Dictate + confirm</div>
            <h2 id="diamond-voice-title" className="mt-1 text-xl font-black text-gray-950">
              Speak, edit, then choose
            </h2>
          </div>
          <button type="button" className="ghost-button !h-10 !min-h-10 !w-10 !p-0" aria-label="Close dictation" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 rounded-xl border border-gray-200 bg-gray-50 p-1">
          <button
            type="button"
            className={`min-h-10 rounded-lg text-xs font-black ${intent === 'play' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500'}`}
            aria-pressed={intent === 'play'}
            onClick={() => onIntentChange('play')}
          >
            Play proposal
          </button>
          <button
            type="button"
            className={`min-h-10 rounded-lg text-xs font-black ${intent === 'private-note' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500'}`}
            aria-pressed={intent === 'private-note'}
            onClick={() => onIntentChange('private-note')}
          >
            Private note
          </button>
        </div>

        <button
          type="button"
          className={`mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-black ${dictating ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-violet-200 bg-violet-50 text-violet-800'}`}
          onClick={onToggleDictation}
          disabled={interpreting || savingNote}
        >
          <Mic className={`h-5 w-5 ${dictating ? 'animate-pulse' : ''}`} aria-hidden="true" />
          {dictating ? 'Stop listening' : 'Start dictation'}
        </button>
        <p className="mt-2 text-center text-[11px] font-bold text-gray-500">
          Speech becomes editable text. Raw audio is never retained or uploaded.
        </p>

        <label className="mt-4 block text-xs font-black text-gray-700" htmlFor="diamond-voice-draft">
          Editable transcript
        </label>
        <textarea
          id="diamond-voice-draft"
          className="mt-1 min-h-28 w-full resize-y rounded-2xl border border-gray-300 bg-white p-3 text-base leading-6 font-semibold text-gray-950 focus:border-violet-500 focus:ring-2 focus:ring-violet-100 focus:outline-none"
          maxLength={intent === 'play' ? 2000 : 2000}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={intent === 'play' ? 'Single to left. Avery scored and Jordan moved to third.' : 'Private coaching or scorer note…'}
        />

        {intent === 'private-note' ? (
          <label className="mt-3 flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 px-3 text-xs font-bold text-gray-700">
            <input
              type="checkbox"
              checked={attachToLastPlay}
              disabled={!hasRecentPlay}
              onChange={(event) => onAttachChange(event.target.checked)}
            />
            Attach to the latest confirmed play
          </label>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs leading-5 font-semibold text-violet-900">
              <div className="flex items-center gap-2 font-black">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                AI prepares a draft only.
              </div>
              It cannot write to the scorebook. You must review and confirm the resulting command.
            </div>
            {questions.length ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-950" role="alert">
                <div className="font-black">
                  Clarification needed
                  {confidence !== null ? ` · AI confidence ${Math.round(confidence * 100)}%` : ''}
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
                <div className="mt-2">Edit the transcript and interpret it again. No command has been created.</div>
              </div>
            ) : null}
          </div>
        )}

        {!online ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">
            Reconnect to interpret dictation or save a private note. Transcripts are not placed in the offline command queue.
          </div>
        ) : null}

        {online && intent === 'play' && !canInterpret ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">
            Refresh the authoritative scorebook and resolve queued commands before interpreting this transcript.
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="ghost-button justify-center" onClick={onClose} disabled={interpreting || savingNote}>
            Cancel
          </button>
          {intent === 'play' ? (
            <button
              type="button"
              className="primary-button justify-center"
              disabled={!draft.trim() || !online || !canInterpret || interpreting}
              onClick={onInterpret}
            >
              {interpreting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              )}
              Interpret play
            </button>
          ) : (
            <button
              type="button"
              className="primary-button justify-center"
              disabled={!draft.trim() || !online || savingNote}
              onClick={onSaveNote}
            >
              {savingNote ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              )}
              Save privately
            </button>
          )}
        </div>
      </section>
    </Modal>
  );
}

function ConfirmationModal({
  confirmation,
  snapshot,
  busy,
  onClose,
  onConfirm
}: {
  confirmation: Confirmation;
  snapshot: DiamondScorebookSnapshot;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const title =
    confirmation.kind === 'finalize'
      ? 'Confirm final score'
      : confirmation.kind === 'rules-decision'
        ? `Confirm ${confirmation.label}?`
        : confirmation.kind === 'reopen'
          ? 'Reopen for correction?'
          : confirmation.kind === 'handoff'
            ? 'Hand off the scorebook?'
            : 'Append this correction?';
  const detail =
    confirmation.kind === 'finalize'
      ? `${snapshot.awayName} ${snapshot.score.away}, ${snapshot.homeName} ${snapshot.score.home}. Ordinary scoring will become read only.`
      : confirmation.kind === 'rules-decision'
        ? `${confirmation.description} This appends an audited ${confirmation.label.toLowerCase()} decision. ${
            confirmation.opensFinalization
              ? 'If the server accepts it, a separate final-score confirmation opens; this decision does not finalize by itself.'
              : 'This ends only the current half inning; advance the half separately after the server accepts it.'
          }`
        : confirmation.kind === 'reopen'
          ? `Reason: ${confirmation.reason}. The final game will enter a visible correction session; changes remain append-only and require finalization again.`
          : confirmation.kind === 'handoff'
            ? `${confirmation.toName} will become the only active scorekeeper after the authoritative revision advances.`
            : `${confirmation.label} remains in canonical history, but its effect will be voided by a new correction event.`;
  return (
    <Modal onClose={onClose} ariaLabelledBy="diamond-confirmation-title">
      <section className="app-card w-full max-w-md p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-700">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 id="diamond-confirmation-title" className="mt-3 text-xl font-black text-gray-950">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 font-semibold text-gray-600">{detail}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="ghost-button justify-center" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primary-button justify-center" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            Confirm
          </button>
        </div>
      </section>
    </Modal>
  );
}
