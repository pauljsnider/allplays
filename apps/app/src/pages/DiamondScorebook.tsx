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
import { interpretDiamondTranscript, type DiamondAiCommandContext, type DiamondAiDependencies } from '../lib/diamondScorebookAi';
import {
  DiamondScorebookError,
  diamondScorebookClient,
  type DiamondCaptureMode,
  type DiamondCommandEnvelope,
  type DiamondCommandOutcome,
  type DiamondCommandType,
  type DiamondJsonObject,
  type DiamondLineupEntry,
  type DiamondPlayerRef,
  type DiamondScorebookClient,
  type DiamondScorebookSnapshot,
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

type RunnerDestination = 'stay' | 'first' | 'second' | 'third' | 'home' | 'out';
type RunnerMoveDraft = {
  key: string;
  label: string;
  playerId: string;
  from: 'batter' | 'first' | 'second' | 'third';
  to: RunnerDestination;
};

type LineupDrafts = Record<DiamondSide, DiamondLineupEntry[]>;

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
};

type PendingVoiceProposal = {
  sourceRevision: number;
  type: DiamondCommandType;
  payload: DiamondJsonObject;
  confidence: number;
  unresolvedQuestions: string[];
};

type Confirmation =
  { kind: 'void'; eventId: string; label: string } | { kind: 'finalize' } | { kind: 'handoff'; toUid: string; toName: string };

type OutcomeOption = {
  result: string;
  label: string;
  batterTo: RunnerDestination;
  outs: number;
  fullOnly?: boolean;
};

const outcomeOptions: OutcomeOption[] = [
  { result: 'single', label: 'Single', batterTo: 'first', outs: 0 },
  { result: 'double', label: 'Double', batterTo: 'second', outs: 0 },
  { result: 'triple', label: 'Triple', batterTo: 'third', outs: 0 },
  { result: 'home_run', label: 'Home run', batterTo: 'home', outs: 0 },
  { result: 'walk', label: 'Walk', batterTo: 'first', outs: 0 },
  { result: 'hit_by_pitch', label: 'Hit by pitch', batterTo: 'first', outs: 0 },
  { result: 'strikeout', label: 'Strikeout', batterTo: 'out', outs: 1 },
  { result: 'ground_out', label: 'Ground out', batterTo: 'out', outs: 1 },
  { result: 'fly_out', label: 'Fly out', batterTo: 'out', outs: 1 },
  { result: 'reached_on_error', label: 'Reached on error', batterTo: 'first', outs: 0, fullOnly: true },
  { result: 'fielders_choice', label: "Fielder's choice", batterTo: 'first', outs: 1, fullOnly: true },
  { result: 'sacrifice_bunt', label: 'Sac bunt', batterTo: 'out', outs: 1, fullOnly: true },
  { result: 'sacrifice_fly', label: 'Sac fly', batterTo: 'out', outs: 1, fullOnly: true },
  { result: 'double_play', label: 'Double play', batterTo: 'out', outs: 2, fullOnly: true }
];

const pitchOptions = [
  { result: 'ball', label: 'Ball' },
  { result: 'called_strike', label: 'Called strike' },
  { result: 'swinging_strike', label: 'Swinging strike' },
  { result: 'foul', label: 'Foul' },
  { result: 'foul_bunt', label: 'Foul bunt' },
  { result: 'in_play', label: 'In play' }
] as const;

const destinationOptions: Array<{ value: RunnerDestination; label: string }> = [
  { value: 'stay', label: 'Hold' },
  { value: 'first', label: '1st' },
  { value: 'second', label: '2nd' },
  { value: 'third', label: '3rd' },
  { value: 'home', label: 'Home' },
  { value: 'out', label: 'Out' }
];

const defensivePositions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'CF', 'RCF', 'RF'] as const;
const minimumVoiceProposalConfidence = 0.75;

function copyLineupDrafts(snapshot: DiamondScorebookSnapshot | null): LineupDrafts {
  return {
    home: snapshot?.lineups.home.map((entry) => ({ ...entry })) || [],
    away: snapshot?.lineups.away.map((entry) => ({ ...entry })) || []
  };
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
  if (result === 'walk' || result === 'hit_by_pitch') {
    if (from === 'third') return occupiedBases.has('first') && occupiedBases.has('second') ? 'home' : 'stay';
    if (from === 'second') return occupiedBases.has('first') ? 'third' : 'stay';
    if (from === 'first') return 'second';
  }
  if (result === 'double_play' && from === 'first') return 'out';
  return 'stay';
}

function buildRunnerMoves(snapshot: DiamondScorebookSnapshot, result: string): RunnerMoveDraft[] {
  const occupiedBases = new Set<RunnerMoveDraft['from']>();
  (['first', 'second', 'third'] as const).forEach((base) => {
    if (snapshot.bases[base]) occupiedBases.add(base);
  });
  const batter = snapshot.currentBatter;
  const moves: RunnerMoveDraft[] = batter
    ? [
        {
          key: `batter:${batter.playerId}`,
          label: `Batter · ${playerLabel(batter)}`,
          playerId: batter.playerId,
          from: 'batter',
          to: getDefaultDestination(result, 'batter', occupiedBases)
        }
      ]
    : [];
  (['third', 'second', 'first'] as const).forEach((base) => {
    const runner = snapshot.bases[base];
    if (!runner) return;
    moves.push({
      key: `${base}:${runner.playerId}`,
      label: `${base[0]!.toUpperCase()}${base.slice(1)} · ${playerLabel(runner)}`,
      playerId: runner.playerId,
      from: base,
      to: getDefaultDestination(result, base, occupiedBases)
    });
  });
  return moves;
}

function buildPendingOutcome(snapshot: DiamondScorebookSnapshot, option: OutcomeOption, source: 'tap' | 'voice' = 'tap'): PendingPlay {
  const runnerMoves = buildRunnerMoves(snapshot, option.result);
  const homeMoves = runnerMoves.filter((move) => move.to === 'home').length;
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
    pending.runnerMoves = pending.runnerMoves.map((move) => {
      if (move.from === 'batter') {
        const to = readString(batterAdvance.to) as RunnerDestination;
        return destinationOptions.some((option) => option.value === to) ? { ...move, to } : move;
      }
      const proposedMove = runnerAdvances.find(
        (entry) => entry && typeof entry === 'object' && readString((entry as Record<string, unknown>).runnerId) === move.playerId
      ) as Record<string, unknown> | undefined;
      const to = readString(proposedMove?.to) as RunnerDestination;
      return destinationOptions.some((option) => option.value === to) ? { ...move, to } : move;
    });
    pending.outsOnPlay = readNumber(payload.outsOnPlay, pending.outsOnPlay);
    pending.runsBattedIn = readNumber(payload.runsBattedIn, pending.runsBattedIn);
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

function validateRunnerReview(pending: PendingPlay, currentOuts: number) {
  if (pending.type !== 'record_plate_appearance') {
    try {
      parseEditableProposalPayload(pending);
      return '';
    } catch (error) {
      return error instanceof SyntaxError
        ? 'The proposed payload is not valid JSON.'
        : describeError(error, 'The proposed payload is invalid.');
    }
  }
  if (!pending.runnerMoves.some((move) => move.from === 'batter'))
    return 'The current batter is missing. Refresh the scorebook before recording this play.';
  const occupiedDestinations = pending.runnerMoves
    .map((move) => move.to)
    .filter((destination) => destination === 'first' || destination === 'second' || destination === 'third');
  if (new Set(occupiedDestinations).size !== occupiedDestinations.length) {
    return 'Two runners cannot finish on the same base. Review every runner destination.';
  }
  const computedOuts = pending.runnerMoves.filter((move) => move.to === 'out').length;
  if (pending.outsOnPlay < computedOuts) return 'Outs on play cannot be lower than the runners marked out.';
  if (currentOuts + pending.outsOnPlay > 3) return 'This play would record more than three outs in the half inning.';
  const scored = pending.runnerMoves.filter((move) => move.to === 'home').length;
  if (pending.runsBattedIn > scored) return 'RBI credit cannot exceed the runners marked safe at home.';
  return '';
}

function canChooseDestination(from: RunnerMoveDraft['from'], destination: RunnerDestination) {
  if (from === 'batter') return destination !== 'stay';
  if (destination === 'stay' || destination === 'home' || destination === 'out') return true;
  if (from === 'first') return destination === 'second' || destination === 'third';
  if (from === 'second') return destination === 'third';
  return false;
}

function buildPendingPayload(snapshot: DiamondScorebookSnapshot, pending: PendingPlay, controlMode: DiamondCaptureMode): DiamondJsonObject {
  if (pending.type !== 'record_plate_appearance') return parseEditableProposalPayload(pending);
  const batter = snapshot.currentBatter;
  const pitcher = snapshot.currentPitcher;
  if (!batter || !pitcher) throw new Error('Set the current batter and pitcher before recording a plate appearance.');
  const batterMove = pending.runnerMoves.find((move) => move.from === 'batter');
  if (!batterMove) throw new Error('Review the batter destination before recording this play.');
  const cause =
    pending.result === 'walk'
      ? 'walk'
      : pending.result === 'hit_by_pitch'
        ? 'hit_by_pitch'
        : pending.result === 'reached_on_error'
          ? 'error'
          : 'batted_ball';
  const fielding: DiamondJsonObject = {};
  if (pending.putoutBy) fielding.putoutBy = pending.putoutBy;
  if (pending.assistBy) fielding.assists = [pending.assistBy];
  if (pending.errorBy) fielding.errors = [{ playerId: pending.errorBy, kind: 'fielding' }];
  if (pending.battedBall !== 'unknown') fielding.battedBall = pending.battedBall;
  const hasFielding = Object.keys(fielding).length > 0;
  const scoredMoves = pending.runnerMoves.filter((move) => move.to === 'home');
  let remainingRbi = pending.runsBattedIn;
  const applyRbi = (to: RunnerDestination) => {
    if (to !== 'home' || remainingRbi <= 0) return false;
    remainingRbi -= 1;
    return true;
  };
  return {
    batterId: batter.playerId,
    pitcherId: pitcher.playerId,
    result: pending.result,
    batterAdvance: {
      to: batterMove.to,
      cause,
      ...(batterMove.to === 'home' ? { countsRun: true, rbi: applyRbi('home') } : {}),
      ...(batterMove.to === 'out' ? { outKind: pending.result === 'strikeout' ? 'strikeout' : 'batter_runner' } : {})
    },
    runnerAdvances: pending.runnerMoves
      .filter((move) => move.from !== 'batter')
      .map((move) => ({
        runnerId: move.playerId,
        from: move.from,
        to: move.to,
        cause,
        ...(move.to === 'home' ? { countsRun: true, rbi: applyRbi('home') } : {}),
        ...(move.to === 'out' ? { outKind: 'force' } : {})
      })),
    outsOnPlay: pending.outsOnPlay,
    runsBattedIn: Math.min(pending.runsBattedIn, scoredMoves.length),
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
  const [snapshot, setSnapshot] = useState<DiamondScorebookSnapshot | null>(initialSnapshot);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [busy, setBusy] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [queueCount, setQueueCount] = useState(() => (teamId && gameId ? client.readQueue(teamId, gameId).length : 0));
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
  const [handoffTarget, setHandoffTarget] = useState('');
  const [lineupDrafts, setLineupDrafts] = useState<LineupDrafts>(() => copyLineupDrafts(initialSnapshot));
  const [lineupDirty, setLineupDirty] = useState<Record<DiamondSide, boolean>>({ home: false, away: false });
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const stopNativeDictationRef = useRef<(() => Promise<void>) | null>(null);
  const reconcileKeyRef = useRef('');
  const snapshotRef = useRef<DiamondScorebookSnapshot | null>(initialSnapshot);
  const queueCountRef = useRef(queueCount);

  snapshotRef.current = snapshot;
  queueCountRef.current = queueCount;

  const backTarget = teamId && gameId ? `/schedule/${encodeURIComponent(teamId)}/${encodeURIComponent(gameId)}?section=game` : '/schedule';

  const refreshSnapshot = useCallback(
    async (showLoading = false) => {
      if (!auth.user || !teamId || !gameId) {
        setLoading(false);
        setNotice({ tone: 'error', message: 'Sign in and open a scheduled game before using Diamond Scorebook.' });
        return null;
      }
      if (showLoading) setLoading(true);
      try {
        const next = await client.load(teamId, gameId);
        setSnapshot(next);
        setControlMode(next.captureMode);
        setNotice(null);
        return next;
      } catch (error) {
        setNotice({ tone: 'error', message: describeError(error, 'Unable to load the diamond scorebook.') });
        return null;
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [auth.user, client, gameId, teamId]
  );

  useEffect(() => {
    if (initialSnapshot) {
      setSnapshot(initialSnapshot);
      setControlMode(initialSnapshot.captureMode);
      setLoading(false);
      return;
    }
    void refreshSnapshot(true);
  }, [initialSnapshot, refreshSnapshot]);

  useEffect(() => {
    if (!snapshot) return;
    setLineupDrafts((current) => ({
      home: lineupDirty.home ? current.home : snapshot.lineups.home.map((entry) => ({ ...entry })),
      away: lineupDirty.away ? current.away : snapshot.lineups.away.map((entry) => ({ ...entry }))
    }));
  }, [lineupDirty.away, lineupDirty.home, snapshot]);

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
    setReconciling(true);
    setNotice({
      tone: 'info',
      message: `Reconciling ${queueCount} queued ${queueCount === 1 ? 'play' : 'plays'} with the authoritative game.`
    });
    try {
      const result = await client.reconcileQueue(teamId, gameId);
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
      setQueueCount(client.readQueue(teamId, gameId).length);
      setNotice({ tone: 'error', message: describeError(error, 'Queued plays could not be reconciled. Refresh before continuing.') });
      if (error instanceof DiamondScorebookError && error.code === 'stale-revision') {
        await refreshSnapshot(false);
      }
    } finally {
      setReconciling(false);
    }
  }, [client, gameId, networkOnline, queueCount, reconciling, refreshSnapshot, teamId]);

  useEffect(() => {
    if (!networkOnline || queueCount === 0) {
      if (queueCount === 0) reconcileKeyRef.current = '';
      return;
    }
    const key = `${teamId}:${gameId}:${queueCount}`;
    if (reconcileKeyRef.current === key) return;
    reconcileKeyRef.current = key;
    void reconcileQueue();
  }, [gameId, networkOnline, queueCount, reconcileQueue, teamId]);

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
    },
    [refreshSnapshot]
  );

  const buildCommand = useCallback(
    (type: DiamondCommandType, payload: DiamondJsonObject) => {
      if (!snapshot) throw new Error('Load the authoritative scorebook before recording a play.');
      return client.createCommand({
        teamId,
        gameId,
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
    async (type: DiamondCommandType, payload: DiamondJsonObject, successMessage: string, options: { allowWhenFinal?: boolean } = {}) => {
      if (!snapshot || busy || reconciling) return false;
      if (!snapshot.lease.canScore) {
        setNotice({ tone: 'error', message: 'This scorebook is read only because another scorekeeper holds the scoring lease.' });
        return false;
      }
      if (snapshot.lifecycle === 'final' && !options.allowWhenFinal) {
        setNotice({ tone: 'error', message: 'This game is final. Reopen it for a confirmed correction before changing the scorebook.' });
        return false;
      }
      let command: DiamondCommandEnvelope;
      try {
        command = buildCommand(type, payload);
      } catch (error) {
        setNotice({ tone: 'error', message: describeError(error, 'This play could not be prepared safely.') });
        return false;
      }

      if (!networkOnline || queueCount > 0) {
        try {
          const queue = client.enqueue(command);
          setQueueCount(queue.length);
          setNotice({
            tone: 'info',
            message: `${successMessage} queued with command ${command.commandId.slice(0, 8)}. The displayed field remains revision ${snapshot.revision} until reconciliation.`
          });
          return true;
        } catch (error) {
          setNotice({ tone: 'error', message: describeError(error, 'This play could not be retained offline.') });
          return false;
        }
      }

      setBusy(true);
      setNotice(null);
      try {
        const outcome = await client.submitCommand(command);
        await applyOutcome(outcome, successMessage);
        return true;
      } catch (error) {
        if (error instanceof DiamondScorebookError && error.retryable) {
          try {
            const queue = client.enqueue(command);
            setQueueCount(queue.length);
            setNotice({
              tone: 'info',
              message: `Confirmation was interrupted. The same command ID is queued for idempotent reconciliation; do not re-enter the play.`
            });
            return true;
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
    [applyOutcome, buildCommand, busy, client, networkOnline, queueCount, reconciling, refreshSnapshot, snapshot]
  );

  const recordPitch = async (result: string, label: string) => {
    if (!snapshot?.currentBatter || !snapshot.currentPitcher) {
      setNotice({ tone: 'error', message: 'Set the current batter and pitcher before recording a pitch.' });
      return;
    }
    await submitCommand(
      'record_pitch',
      {
        batterId: snapshot.currentBatter.playerId,
        pitcherId: snapshot.currentPitcher.playerId,
        result
      },
      `${label} recorded.`
    );
  };

  const confirmPendingPlay = async () => {
    if (!snapshot || !pendingPlay) return;
    if (pendingPlay.source === 'voice' && (pendingPlay.sourceRevision !== snapshot.revision || !snapshot.authoritative || queueCount > 0)) {
      setPendingPlay(null);
      setNotice({
        tone: 'error',
        message: 'This AI draft is stale because the scorebook revision changed. Interpret the play again from the current field state.'
      });
      return;
    }
    const validationError = validateRunnerReview(pendingPlay, snapshot.inning.outs);
    if (validationError) {
      setNotice({ tone: 'error', message: validationError });
      return;
    }
    if (!pendingPlay.ambiguityConfirmed) {
      setNotice({ tone: 'error', message: 'Verify every unresolved AI field before confirming this play.' });
      return;
    }
    try {
      const payload = buildPendingPayload(snapshot, pendingPlay, controlMode);
      const submitted = await submitCommand(pendingPlay.type, payload, `${pendingPlay.label} recorded.`);
      if (submitted) setPendingPlay(null);
    } catch (error) {
      setNotice({ tone: 'error', message: describeError(error, 'Review this play before submitting it.') });
    }
  };

  const handleConfirmation = async () => {
    if (!confirmation || !snapshot) return;
    if (confirmation.kind === 'void') {
      const submitted = await submitCommand(
        'void_event',
        {
          targetEventId: confirmation.eventId,
          reason: 'Scorekeeper undo from recent plays'
        },
        `Correction appended for ${confirmation.label}.`
      );
      if (submitted) setConfirmation(null);
      return;
    }
    if (confirmation.kind === 'finalize') {
      const submitted = await submitCommand('finalize', { confirmed: true }, 'Final score confirmed.');
      if (submitted) setConfirmation(null);
      return;
    }
    setBusy(true);
    try {
      const outcome = await client.requestHandoff({
        teamId,
        gameId,
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
      setPendingPlay(buildPendingVoicePlay(requestSnapshot, proposal));
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
      const outcome = await client.savePrivateNote({
        teamId,
        gameId,
        expectedRevision: snapshot.revision,
        rulesProfileId: snapshot.rulesProfileId,
        rulesProfileVersion: snapshot.rulesProfileVersion,
        text: voiceDraft,
        attachedEventId: attachNoteToLastPlay ? snapshot.recentPlays[snapshot.recentPlays.length - 1]?.eventId || null : null
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
          battingRole: entry.battingRole || 'regular'
        }))
      },
      `${side === 'home' ? snapshot?.homeName || 'Home' : snapshot?.awayName || 'Away'} lineup saved.`
    );
    if (submitted) setLineupDirty((current) => ({ ...current, [side]: false }));
  };

  const visibleOutcomes = outcomeOptions.filter((option) => controlMode === 'full' || !option.fullOnly);
  const latestCorrectablePlay = snapshot ? [...snapshot.recentPlays].reverse().find((play) => !play.voided) || null : null;
  const otherScorers = useMemo(
    () => snapshot?.lease.eligibleScorers.filter((scorer) => scorer.playerId !== snapshot.lease.holderUid) || [],
    [snapshot?.lease.eligibleScorers, snapshot?.lease.holderUid]
  );
  const mutationDisabled = Boolean(
    !snapshot || busy || reconciling || !snapshot.lease.canScore || !snapshot.authoritative || queueCount > 0
  );
  const playControlsDisabled = mutationDisabled || snapshot?.lifecycle !== 'active';
  const correctionControlsDisabled = mutationDisabled || !snapshot || !['active', 'correction'].includes(snapshot.lifecycle);
  const privateNoteDisabled = mutationDisabled || snapshot?.lifecycle === 'configured';
  const lineupsReady = Boolean(snapshot?.lineups.home.length && snapshot.lineups.away.length);

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
                      ? lineupsReady
                        ? 'Both lineups are set. Start the game when both teams are ready.'
                        : 'Build and save both batting orders before starting.'
                      : 'Complete both lineups before starting the game.',
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
      <header className="app-card shadow-app-lg overflow-hidden border-emerald-900 bg-emerald-950 text-white">
        <div className="flex items-center justify-between gap-3 border-b border-emerald-800 px-3 py-2">
          <Link
            to={backTarget}
            className="inline-flex min-h-10 items-center gap-1 rounded-xl px-2 text-xs font-black text-emerald-50 hover:bg-emerald-900 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Game
          </Link>
          <div className="min-w-0 text-center">
            <div className="truncate text-xs font-black tracking-widest text-emerald-200 uppercase">Diamond Scorebook</div>
            <div className="truncate text-sm font-black">
              {snapshot.teamName} vs {snapshot.opponentName}
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-emerald-50 hover:bg-emerald-900 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
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
            <div className="rounded-full border border-emerald-700 bg-emerald-900 px-3 py-1 text-[11px] font-black tracking-wider text-emerald-100 uppercase">
              {inningLabel(snapshot)}
            </div>
            <div className="mt-2 text-xs font-bold text-emerald-200">
              {snapshot.inning.outs} {snapshot.inning.outs === 1 ? 'out' : 'outs'}
            </div>
          </div>
          <ScoreSide name={snapshot.homeName} score={snapshot.score.home} align="right" />
        </div>

        <div className="grid grid-cols-2 gap-px bg-emerald-800">
          <div className="bg-emerald-950 px-4 py-2 text-center">
            <div className="text-[10px] font-black tracking-wider text-emerald-300 uppercase">Count</div>
            <div className="mt-0.5 text-lg font-black tabular-nums">
              {snapshot.inning.balls}–{snapshot.inning.strikes}
            </div>
          </div>
          <div className="bg-emerald-950 px-4 py-2 text-center">
            <div className="text-[10px] font-black tracking-wider text-emerald-300 uppercase">Rules</div>
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

      {snapshot.lifecycle === 'ready' ? (
        <LineupSetup
          snapshot={snapshot}
          drafts={lineupDrafts}
          dirty={lineupDirty}
          disabled={mutationDisabled}
          online={networkOnline}
          onChange={updateLineup}
          onAddManual={addManualLineupPlayer}
          onSave={(side) => void saveLineup(side)}
          onStart={() => void submitCommand('start', {}, 'Game started.')}
          canStart={lineupsReady && !lineupDirty.home && !lineupDirty.away}
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

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(17rem,0.8fr)]">
        <div className="space-y-3">
          <section className="app-card overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
              <PlayerContext label="At bat" player={snapshot.currentBatter} />
              <PlayerContext label="Pitching" player={snapshot.currentPitcher} />
            </div>
            <BaseDiamond snapshot={snapshot} />
          </section>

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
                    className={`min-h-9 rounded-lg px-3 text-xs font-black capitalize ${controlMode === mode ? 'text-primary-700 bg-white shadow-sm' : 'text-gray-500'}`}
                    aria-pressed={controlMode === mode}
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
                  ? 'Full controls are visible, but this game was activated in Quick capture; uncollected stat families remain explicitly partial.'
                  : 'Quick controls are visible. The game still retains its Full capture requirement.'}
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
                      disabled={playControlsDisabled}
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
                    disabled={playControlsDisabled}
                    onClick={() => setPendingPlay(buildPendingOutcome(snapshot, outcome))}
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

            {snapshot.inning.outs === 3 ? (
              <button
                type="button"
                className="primary-button mt-3 w-full justify-center"
                disabled={playControlsDisabled}
                onClick={() => void submitCommand('advance_half_inning', {}, 'Half inning advanced.')}
              >
                Advance to {snapshot.inning.half === 'top' ? `bottom ${snapshot.inning.number}` : `top ${snapshot.inning.number + 1}`}
              </button>
            ) : null}

            {controlMode === 'full' ? (
              <AdvancedScoringPanel
                snapshot={snapshot}
                disabled={mutationDisabled}
                onReview={(type, label, payload) => setPendingPlay(buildStructuredPending(type, label, payload))}
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
                className="ghost-button !min-h-9 !px-3 text-xs"
                disabled={!latestCorrectablePlay || correctionControlsDisabled}
                onClick={() =>
                  latestCorrectablePlay &&
                  setConfirmation({ kind: 'void', eventId: latestCorrectablePlay.eventId, label: latestCorrectablePlay.label })
                }
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Correct last
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
          </section>
        </div>

        <aside className="space-y-3">
          <section className="app-card p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <UserRoundCheck className="text-primary-600 h-5 w-5" aria-hidden="true" />
              <h2 className="text-sm font-black text-gray-950">Scoring lease</h2>
            </div>
            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="text-sm font-black text-gray-900">
                {snapshot.lease.canScore ? 'You have the scorebook' : `${snapshot.lease.holderName || 'Another scorekeeper'} is scoring`}
              </div>
              <div className="mt-1 text-xs leading-5 font-semibold text-gray-600">
                {snapshot.lease.canScore
                  ? 'Only your confirmed commands can advance this revision.'
                  : 'Controls stay read only until the current scorer hands off.'}
              </div>
            </div>
            {snapshot.lease.canScore && otherScorers.length ? (
              <div className="mt-3">
                <label className="text-xs font-black text-gray-700" htmlFor="diamond-handoff-target">
                  Hand off to
                </label>
                <select
                  id="diamond-handoff-target"
                  className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold text-gray-900"
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

          <section className="app-card p-3 sm:p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-emerald-600" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-black text-gray-950">Finish deliberately</h2>
                <p className="mt-1 text-xs leading-5 font-semibold text-gray-600">
                  Finalizing locks ordinary scoring. Any later change must reopen a visible correction session.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="mt-3 min-h-11 w-full rounded-xl border border-rose-200 bg-rose-50 px-3 text-sm font-black text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={mutationDisabled || !['active', 'correction'].includes(snapshot.lifecycle)}
              onClick={() => setConfirmation({ kind: 'finalize' })}
            >
              Review final score
            </button>
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
          hasRecentPlay={Boolean(latestCorrectablePlay)}
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
    </div>
  );
}

function LineupSetup({
  snapshot,
  drafts,
  dirty,
  disabled,
  online,
  onChange,
  onAddManual,
  onSave,
  onStart,
  canStart
}: {
  snapshot: DiamondScorebookSnapshot;
  drafts: LineupDrafts;
  dirty: Record<DiamondSide, boolean>;
  disabled: boolean;
  online: boolean;
  onChange: (side: DiamondSide, entries: DiamondLineupEntry[]) => void;
  onAddManual: (side: DiamondSide, name: string, number: string) => boolean;
  onSave: (side: DiamondSide) => void;
  onStart: () => void;
  canStart: boolean;
}) {
  return (
    <section className="app-card border-sky-200 p-3 sm:p-4" aria-labelledby="diamond-lineup-setup-title">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-sky-700" aria-hidden="true" />
        <div>
          <h2 id="diamond-lineup-setup-title" className="text-base font-black text-gray-950">
            Set both batting orders
          </h2>
          <p className="mt-1 text-xs leading-5 font-semibold text-gray-600">
            Save each side as one authoritative command. Start stays locked until both saved lineups are confirmed.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {(['away', 'home'] as const).map((side) => (
          <LineupSideEditor
            key={side}
            side={side}
            name={side === 'home' ? snapshot.homeName : snapshot.awayName}
            entries={drafts[side]}
            candidates={snapshot.availablePlayers[side]}
            dirty={dirty[side]}
            disabled={disabled}
            online={online}
            showBattingRole={snapshot.ruleCapabilities.dpFlex}
            onChange={(entries) => onChange(side, entries)}
            onAddManual={(name, number) => onAddManual(side, name, number)}
            onSave={() => onSave(side)}
          />
        ))}
      </div>
      <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sky-950">
        <div className="text-sm font-black">{canStart ? 'Both lineups are authoritative' : 'Start is locked'}</div>
        <div className="mt-1 text-xs leading-5 font-semibold">
          {canStart
            ? 'Confirm the batting orders once more, then start the game.'
            : 'Add at least one player to each side and save every unsaved change.'}
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

function LineupSideEditor({
  side,
  name,
  entries,
  candidates,
  dirty,
  disabled,
  online,
  showBattingRole,
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
  showBattingRole: boolean;
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
                className="ghost-button !h-9 !min-h-9 !w-9 !p-0"
                aria-label={`Move ${entry.name} up`}
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ghost-button !h-9 !min-h-9 !w-9 !p-0"
                aria-label={`Move ${entry.name} down`}
                disabled={disabled || index === entries.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ghost-button !h-9 !min-h-9 !w-9 !p-0 text-rose-700"
                aria-label={`Remove ${entry.name}`}
                disabled={disabled}
                onClick={() => onChange(entries.filter((candidate) => candidate.playerId !== entry.playerId))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {showBattingRole ? (
              <label className="mt-2 block text-[11px] font-black text-gray-600">
                Batting role
                <select
                  aria-label={`${entry.name} batting role`}
                  className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-2 text-xs font-bold"
                  value={entry.battingRole || 'regular'}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      entries.map((candidate) =>
                        candidate.playerId === entry.playerId ? { ...candidate, battingRole: event.target.value } : candidate
                      )
                    )
                  }
                >
                  <option value="regular">Regular</option>
                  <option value="dp">DP</option>
                  <option value="flex">FLEX</option>
                  <option value="eh">EH</option>
                  <option value="ep">EP</option>
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

function AdvancedScoringPanel({
  snapshot,
  disabled,
  onReview
}: {
  snapshot: DiamondScorebookSnapshot;
  disabled: boolean;
  onReview: (type: DiamondCommandType, label: string, payload: DiamondJsonObject) => void;
}) {
  const battingSide: DiamondSide = snapshot.inning.half === 'top' ? 'away' : 'home';
  const occupiedBases = (['first', 'second', 'third'] as const).flatMap((base) => {
    const runner = snapshot.bases[base];
    return runner ? [{ base, runner }] : [];
  });
  const [runnerBase, setRunnerBase] = useState<'first' | 'second' | 'third'>('first');
  const [runnerAction, setRunnerAction] = useState<'stolen_base' | 'caught_stealing' | 'pickoff' | 'wild_pitch' | 'passed_ball'>(
    'stolen_base'
  );
  const [suspendReason, setSuspendReason] = useState('');
  const [subSide, setSubSide] = useState<DiamondSide>(battingSide);
  const [subSlot, setSubSlot] = useState('1');
  const [incomingPlayerId, setIncomingPlayerId] = useState('');
  const [structuredType, setStructuredType] = useState<'record_fielding' | 'record_scoring_judgment'>('record_fielding');
  const latestEventId = [...snapshot.recentPlays].reverse().find((play) => !play.voided)?.eventId || '';
  const [structuredDraft, setStructuredDraft] = useState(() =>
    JSON.stringify({ playEventId: latestEventId, fielding: { putoutBy: '' } }, null, 2)
  );
  const [structuredError, setStructuredError] = useState('');
  const [dpSide, setDpSide] = useState<DiamondSide>(battingSide);
  const [dpPlayerId, setDpPlayerId] = useState('');
  const [flexPlayerId, setFlexPlayerId] = useState('');
  const [dpPosition, setDpPosition] = useState<(typeof defensivePositions)[number]>('P');
  const [courtesyBase, setCourtesyBase] = useState<'first' | 'second' | 'third'>('first');
  const [courtesyRole, setCourtesyRole] = useState<'pitcher' | 'catcher'>('pitcher');
  const [courtesyRunnerId, setCourtesyRunnerId] = useState('');

  const activeRunner = occupiedBases.find((entry) => entry.base === runnerBase) || occupiedBases[0] || null;
  const subLineup = snapshot.lineups[subSide];
  const subEntry = subLineup.find((entry) => entry.slot === Number(subSlot)) || subLineup[0] || null;
  const subCandidates = snapshot.availablePlayers[subSide].filter(
    (player) => !subLineup.some((entry) => entry.playerId === player.playerId) && player.playerId !== subEntry?.playerId
  );
  const dpLineup = snapshot.lineups[dpSide];
  const dpCandidates = [...snapshot.availablePlayers[dpSide], ...dpLineup].filter(
    (player, index, all) => all.findIndex((candidate) => candidate.playerId === player.playerId) === index
  );
  const courtesyPlacement = occupiedBases.find((entry) => entry.base === courtesyBase) || occupiedBases[0] || null;
  const occupiedIds = new Set(occupiedBases.map((entry) => entry.runner.playerId));
  const courtesyCandidates = snapshot.availablePlayers[battingSide].filter((player) => !occupiedIds.has(player.playerId));
  const canUseCourtesy = snapshot.ruleCapabilities.courtesyRunner[courtesyRole];

  const reviewRunnerEvent = () => {
    if (!activeRunner) return;
    const to =
      runnerAction === 'caught_stealing' || runnerAction === 'pickoff'
        ? 'out'
        : activeRunner.base === 'first'
          ? 'second'
          : activeRunner.base === 'second'
            ? 'third'
            : 'home';
    onReview('advance_runner', runnerAction.replace(/_/g, ' '), {
      runnerId: activeRunner.runner.playerId,
      from: activeRunner.base,
      to,
      cause: runnerAction,
      ...(to === 'out' ? { outKind: 'tag' } : {}),
      ...(to === 'home' ? { countsRun: true } : {}),
      omissions: ['fielding', 'situational']
    });
  };

  const reviewStructured = () => {
    try {
      const payload = JSON.parse(structuredDraft) as unknown;
      if (!payload || Array.isArray(payload) || typeof payload !== 'object' || containsSensitiveProposalField(payload)) {
        throw new Error('Enter a JSON object without audio, transcripts, or private-note fields.');
      }
      const record = payload as Record<string, unknown>;
      if (!readString(record.playEventId)) throw new Error('A confirmed playEventId is required.');
      if (structuredType === 'record_fielding') {
        const fielding = record.fielding && typeof record.fielding === 'object' ? (record.fielding as Record<string, unknown>) : {};
        if (!Object.values(fielding).some((value) => value !== '' && value !== null && value !== undefined)) {
          throw new Error('Enter at least one fielding detail; never guess an omitted value.');
        }
      } else if (Object.keys(record).every((key) => key === 'playEventId')) {
        throw new Error('Enter at least one explicit scoring judgment.');
      }
      setStructuredError('');
      onReview(structuredType, structuredType === 'record_fielding' ? 'fielding detail' : 'scoring judgment', record as DiamondJsonObject);
    } catch (error) {
      setStructuredError(
        error instanceof SyntaxError ? 'The structured command is not valid JSON.' : describeError(error, 'Review the command details.')
      );
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
              onChange={(event) => setRunnerBase(event.target.value as typeof runnerBase)}
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
              onChange={(event) => setRunnerAction(event.target.value as typeof runnerAction)}
            >
              <option value="stolen_base">Stolen base</option>
              <option value="caught_stealing">Caught stealing</option>
              <option value="pickoff">Pickoff</option>
              <option value="wild_pitch">Wild pitch</option>
              <option value="passed_ball">Passed ball</option>
            </select>
          </label>
        </div>
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
        <div className="grid gap-2 sm:grid-cols-3">
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
              onChange={(event) => setSubSlot(event.target.value)}
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
        </div>
        <button
          type="button"
          className="ghost-button mt-2 w-full justify-center text-xs"
          disabled={disabled || snapshot.lifecycle !== 'active' || !subEntry || !incomingPlayerId}
          onClick={() =>
            subEntry &&
            onReview('substitute', 'substitution', {
              side: subSide,
              battingSlot: subEntry.slot,
              outgoingPlayerId: subEntry.playerId,
              incomingPlayerId
            })
          }
        >
          Review substitution
        </button>
      </fieldset>

      {snapshot.ruleCapabilities.dpFlex ? (
        <fieldset className="mt-3 rounded-xl border border-violet-200 bg-white p-3">
          <legend className="px-1 text-xs font-black text-gray-800">Fastpitch DP/FLEX</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[11px] font-black text-gray-600">
              Side
              <select
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm font-bold"
                value={dpSide}
                disabled={disabled || !['ready', 'active'].includes(snapshot.lifecycle)}
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
                disabled={disabled || !dpLineup.length || !['ready', 'active'].includes(snapshot.lifecycle)}
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
                disabled={disabled || !['ready', 'active'].includes(snapshot.lifecycle)}
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
                disabled={disabled || !['ready', 'active'].includes(snapshot.lifecycle)}
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
            disabled={disabled || !['ready', 'active'].includes(snapshot.lifecycle) || !dpPlayerId || !flexPlayerId}
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
                disabled={disabled || !occupiedBases.length || snapshot.lifecycle !== 'active'}
                onChange={(event) => setCourtesyBase(event.target.value as typeof courtesyBase)}
              >
                {!occupiedBases.length ? <option value="">No runners</option> : null}
                {occupiedBases.map(({ base, runner }) => (
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
                value={courtesyRole}
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
                forRole: courtesyRole
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
          For experienced scorers. Enter only observed details using player and play IDs. Empty detail is rejected.
        </p>
        <select
          aria-label="Structured command type"
          className="mt-2 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
          value={structuredType}
          disabled={disabled || !['active', 'correction'].includes(snapshot.lifecycle)}
          onChange={(event) => {
            const type = event.target.value as typeof structuredType;
            setStructuredType(type);
            setStructuredDraft(
              JSON.stringify(
                type === 'record_fielding'
                  ? { playEventId: latestEventId, fielding: { putoutBy: '' } }
                  : { playEventId: latestEventId, earned: true },
                null,
                2
              )
            );
            setStructuredError('');
          }}
        >
          <option value="record_fielding">Fielding detail</option>
          <option value="record_scoring_judgment">Scoring judgment</option>
        </select>
        <textarea
          aria-label="Structured command details"
          className="mt-2 min-h-40 w-full rounded-xl border border-gray-300 bg-white p-3 font-mono text-xs leading-5"
          value={structuredDraft}
          disabled={disabled || !['active', 'correction'].includes(snapshot.lifecycle)}
          onChange={(event) => setStructuredDraft(event.target.value)}
          spellCheck={false}
        />
        {structuredError ? (
          <div className="mt-2 text-xs font-bold text-rose-700" role="alert">
            {structuredError}
          </div>
        ) : null}
        <button
          type="button"
          className="ghost-button mt-2 w-full justify-center text-xs"
          disabled={disabled || !['active', 'correction'].includes(snapshot.lifecycle)}
          onClick={reviewStructured}
        >
          Review structured command
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
    <div className="relative mx-auto h-48 max-w-sm" aria-label="Base runners">
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
      <div className="flex items-center gap-2">
        <CircleDot className="text-primary-600 h-5 w-5" aria-hidden="true" />
        <h2 className="text-sm font-black text-gray-950">Stat coverage</h2>
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
  const validationError = validateRunnerReview(pending, snapshot.inning.outs);
  const setOutcome = (result: string) => {
    const option = outcomeOptions.find((candidate) => candidate.result === result);
    if (!option) return;
    const next = buildPendingOutcome(snapshot, option, pending.source);
    onChange({
      ...next,
      unresolvedFields: pending.unresolvedFields,
      ambiguityConfirmed: pending.ambiguityConfirmed,
      aiConfidence: pending.aiConfidence,
      sourceRevision: pending.sourceRevision
    });
  };
  return (
    <Modal
      onClose={onClose}
      ariaLabelledBy="diamond-play-review-title"
      overlayClassName="z-50 flex items-end justify-center bg-gray-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <section className="shadow-app-lg max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-4 sm:rounded-3xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-primary-600 text-[10px] font-black tracking-widest uppercase">
              {pending.source === 'voice' ? 'AI draft · confirmation required' : 'Atomic play review'}
            </div>
            <h2 id="diamond-play-review-title" className="mt-1 text-xl font-black text-gray-950">
              Review {pending.label}
            </h2>
            <p className="mt-1 text-xs leading-5 font-semibold text-gray-600">Nothing is recorded until you confirm this complete play.</p>
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
                  <option key={option.result} value={option.result}>
                    {option.label}
                  </option>
                ))}
            </select>

            <fieldset className="mt-4">
              <legend className="text-xs font-black text-gray-700">Runner destinations</legend>
              <div className="mt-2 space-y-2">
                {pending.runnerMoves.map((move) => (
                  <label
                    key={move.key}
                    className="grid min-h-12 grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 rounded-xl border border-gray-200 px-3"
                  >
                    <span className="truncate text-sm font-bold text-gray-900">{move.label}</span>
                    <select
                      aria-label={`${move.label} destination`}
                      className="min-h-10 rounded-lg border border-gray-300 bg-white px-2 text-sm font-black"
                      value={move.to}
                      onChange={(event) =>
                        onChange({
                          ...pending,
                          runnerMoves: pending.runnerMoves.map((candidate) =>
                            candidate.key === move.key ? { ...candidate, to: event.target.value as RunnerDestination } : candidate
                          )
                        })
                      }
                    >
                      {destinationOptions
                        .filter((option) => canChooseDestination(move.from, option.value))
                        .map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-xs font-black text-gray-700">
                Outs on play
                <select
                  className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-black"
                  value={pending.outsOnPlay}
                  onChange={(event) => onChange({ ...pending, outsOnPlay: Number(event.target.value) })}
                >
                  {[0, 1, 2, 3].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-black text-gray-700">
                RBI credit
                <select
                  className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-black"
                  value={pending.runsBattedIn}
                  onChange={(event) => onChange({ ...pending, runsBattedIn: Number(event.target.value) })}
                >
                  {[0, 1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {controlMode === 'full' ? (
              <fieldset className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <legend className="px-1 text-xs font-black text-gray-700">Fielding detail</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FielderSelect
                    label="Putout"
                    value={pending.putoutBy}
                    players={snapshot.defensiveLineup}
                    onChange={(value) => onChange({ ...pending, putoutBy: value })}
                  />
                  <FielderSelect
                    label="Assist"
                    value={pending.assistBy}
                    players={snapshot.defensiveLineup}
                    onChange={(value) => onChange({ ...pending, assistBy: value })}
                  />
                  <FielderSelect
                    label="Error"
                    value={pending.errorBy}
                    players={snapshot.defensiveLineup}
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
        ) : (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="text-sm font-semibold text-gray-700">
              Proposed command: <span className="font-black">{pending.type.replace(/_/g, ' ')}</span>
            </div>
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
          </div>
        )}

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
            Confirm play
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
  onChange
}: {
  label: string;
  value: string;
  players: DiamondPlayerRef[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-black text-gray-700">
      {label}
      <select
        className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-bold"
        value={value}
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
      <section className="shadow-app-lg w-full max-w-lg rounded-t-3xl bg-white p-4 sm:rounded-3xl sm:p-5">
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
      : confirmation.kind === 'handoff'
        ? 'Hand off the scorebook?'
        : 'Append this correction?';
  const detail =
    confirmation.kind === 'finalize'
      ? `${snapshot.awayName} ${snapshot.score.away}, ${snapshot.homeName} ${snapshot.score.home}. Ordinary scoring will become read only.`
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
