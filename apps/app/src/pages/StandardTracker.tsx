import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, RotateCcw } from 'lucide-react';
import {
  loadHomeScoringPlayers,
  loadOpponentScoringPlayers,
  loadOpponentStatsForGame,
  loadParentScheduleEventDetail,
  loadScorekeeperStatTrackerConfigsForApp,
  adjustGameScore,
  type ScheduleHomeScoringPlayer,
  type ScheduleOpponentStatsEntry,
  type ScheduleStatTrackerConfigOption
} from '../lib/scheduleService';
import { type ParentScheduleEvent } from '../lib/scheduleLogic';
import { createDefaultStatTrackingService, type TrackerLogEntry, type TrackerScoreState } from '../lib/statTrackingService';
import {
  applyStandardTrackerTallyDelta,
  buildStandardTrackerOpponentStatsEntry,
  buildStandardTrackerTallies,
  buildStandardTrackerViewModel,
  type StandardTrackerCell,
  type StandardTrackerColumn,
  type StandardTrackerPlayer,
  type StandardTrackerRosterPlayerInput,
  type StandardTrackerTallies
} from '../lib/standardTrackerViewModel';
import { readStandardTrackerSession, writeStandardTrackerSession } from '../lib/standardTrackerSession';
import { EventDetailPageSkeleton } from '../components/PageSkeletons';
import { WORKFLOW_TIMING, startWorkflowTimer } from '../lib/workflowTiming';
import type { AuthState } from '../lib/types';

type TrackerStatus = {
  tone: 'success' | 'error' | 'info';
  message: string;
};

type TrackerService = ReturnType<typeof createDefaultStatTrackingService>;

function normalizeScoreValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function getSavedScore(event: ParentScheduleEvent | null): TrackerScoreState {
  return {
    homeScore: normalizeScoreValue(event?.homeScore),
    awayScore: normalizeScoreValue(event?.awayScore)
  };
}

function scoresMatch(first: TrackerScoreState, second: TrackerScoreState) {
  return normalizeScoreValue(first.homeScore) === normalizeScoreValue(second.homeScore)
    && normalizeScoreValue(first.awayScore) === normalizeScoreValue(second.awayScore);
}

function getTrackerPeriod(event: ParentScheduleEvent | null) {
  return String(event?.liveClockPeriod || (event as Record<string, unknown> | null)?.period || 'Q1');
}

function getPlayerLabel(player: { name: string; number?: string | null }) {
  return `${player.number ? `#${player.number} ` : ''}${player.name}`;
}

function getOpponentName(event: ParentScheduleEvent | null) {
  return String(event?.opponentTeamName || event?.opponent || 'Opponent').trim() || 'Opponent';
}

function getTeamScoreSide(event: ParentScheduleEvent | null): 'home' | 'away' {
  return event?.isHome === false ? 'away' : 'home';
}

function getOpponentScoreSide(event: ParentScheduleEvent | null): 'home' | 'away' {
  return event?.isHome === false ? 'home' : 'away';
}

function normalizeOpponentStatsValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function buildOpponentStatsLookup(opponentStats: Record<string, ScheduleOpponentStatsEntry>) {
  const lookup = new Map<string, Record<string, number>>();

  Object.entries(opponentStats || {}).forEach(([entryId, entry]) => {
    const stats = Object.entries(entry || {}).reduce<Record<string, number>>((acc, [key, value]) => {
      if (['name', 'number', 'playerId', 'photoUrl'].includes(key)) return acc;
      acc[String(key).trim().toLowerCase()] = normalizeOpponentStatsValue(value);
      return acc;
    }, {});
    const exactEntryId = String(entryId || '').trim();
    const playerId = String(entry?.playerId || '').trim();
    if (exactEntryId) lookup.set(exactEntryId, stats);
    if (playerId) lookup.set(playerId, stats);
  });

  return lookup;
}

function buildOpponentPlayers(
  event: ParentScheduleEvent | null,
  linkedRoster: ScheduleHomeScoringPlayer[],
  opponentStats: Record<string, ScheduleOpponentStatsEntry>
): StandardTrackerRosterPlayerInput[] {
  const statsLookup = buildOpponentStatsLookup(opponentStats);
  if (linkedRoster.length > 0) {
    return linkedRoster.map((player) => ({
      ...player,
      playerId: player.id,
      photoUrl: player.photoUrl || '',
      stats: statsLookup.get(player.id) || player.stats || {}
    }));
  }
  return [{
    id: 'opponent',
    playerId: null,
    name: getOpponentName(event),
    number: '',
    photoUrl: String(event?.opponentTeamPhoto || ''),
    stats: statsLookup.get('opponent') || {}
  }];
}

function getLogEntryLabel(entry: TrackerLogEntry | null | undefined) {
  if (!entry) return 'Last stat';
  const statKey = String(entry.aggregateStatKey || entry.event?.statKey || 'stat').toUpperCase();
  const value = Number(entry.aggregateDelta || entry.event?.value || 0);
  const playerLabel = getPlayerLabel({ name: entry.playerName || 'Player', number: entry.playerNumber });
  return `${playerLabel} ${statKey} ${value > 0 ? `+${value}` : value}`;
}

export function StandardTracker({ auth }: { auth: AuthState }) {
  const { teamId = '', eventId = '' } = useParams();
  const decodedTeamId = decodeURIComponent(teamId);
  const decodedEventId = decodeURIComponent(eventId);
  const [event, setEvent] = useState<ParentScheduleEvent | null>(null);
  const [config, setConfig] = useState<ScheduleStatTrackerConfigOption | null>(null);
  const [players, setPlayers] = useState<ScheduleHomeScoringPlayer[]>([]);
  const [opponentPlayers, setOpponentPlayers] = useState<StandardTrackerRosterPlayerInput[]>([]);
  const [score, setScore] = useState<TrackerScoreState>({ homeScore: 0, awayScore: 0 });
  const [tallies, setTallies] = useState<StandardTrackerTallies>({});
  const [opponentTallies, setOpponentTallies] = useState<StandardTrackerTallies>({});
  const [eventLog, setEventLog] = useState<TrackerLogEntry[]>([]);
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCellId, setSavingCellId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const serviceRef = useRef<TrackerService | null>(null);

  const backTarget = `/schedule/${encodeURIComponent(decodedTeamId)}/${encodeURIComponent(decodedEventId)}?section=game`;

  const persistSession = useCallback((
    nextScore: TrackerScoreState,
    nextTallies: StandardTrackerTallies,
    nextOpponentTallies: StandardTrackerTallies,
    nextLog: TrackerLogEntry[]
  ) => {
    writeStandardTrackerSession({
      teamId: decodedTeamId,
      gameId: decodedEventId,
      statTrackerConfigId: config?.id || event?.statTrackerConfigId || null,
      score: nextScore,
      tallies: nextTallies,
      opponentTallies: nextOpponentTallies,
      eventLog: nextLog
    });
  }, [config?.id, decodedEventId, decodedTeamId, event?.statTrackerConfigId]);

  useEffect(() => {
    let cancelled = false;

    async function loadTracker() {
      const signedInUser = auth.user;
      if (!signedInUser) {
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      setLoading(true);
      setStatus(null);
      setAccessDenied(false);
      serviceRef.current = null;
      const timer = startWorkflowTimer(WORKFLOW_TIMING.standardTrackerLoad, {
        route: 'standard-tracker'
      });

      try {
        const detail = await loadParentScheduleEventDetail(signedInUser, { teamId: decodedTeamId, eventId: decodedEventId });
        if (cancelled) {
          timer.end({ cancelled: true });
          return;
        }
        const loadedEvent = detail.events.find((candidate) => candidate.teamId === decodedTeamId && candidate.id === decodedEventId) || detail.events[0] || null;
        const canTrack = Boolean(loadedEvent && loadedEvent.type === 'game' && loadedEvent.isDbGame && !loadedEvent.isCancelled && loadedEvent.canUpdateScore);
        if (!canTrack) {
          setEvent(loadedEvent);
          setConfig(null);
          setPlayers([]);
          setOpponentPlayers([]);
          setTallies({});
          setOpponentTallies({});
          setEventLog([]);
          setAccessDenied(true);
          timer.end({ canTrack: false, eventRows: detail.events.length });
          return;
        }

        const [configs, roster, linkedOpponentRoster, opponentStats] = await Promise.all([
          loadScorekeeperStatTrackerConfigsForApp(decodedTeamId, signedInUser, loadedEvent),
          loadHomeScoringPlayers(decodedTeamId, decodedEventId),
          loadedEvent.opponentTeamId
            ? loadOpponentScoringPlayers(loadedEvent.opponentTeamId).catch(() => [])
            : Promise.resolve([]),
          loadOpponentStatsForGame(decodedTeamId, decodedEventId).catch(() => ({}))
        ]);
        if (cancelled) {
          timer.end({ cancelled: true });
          return;
        }

        const trackerConfig = configs.find((candidate) => candidate.id === loadedEvent.statTrackerConfigId) || null;
        const baseScore = getSavedScore(loadedEvent);
        const session = readStandardTrackerSession(decodedTeamId, decodedEventId, trackerConfig?.id || loadedEvent.statTrackerConfigId || null);
        const canRestoreSession = Boolean(session && scoresMatch(session.score, baseScore));
        const loadedViewModel = buildStandardTrackerViewModel({ config: trackerConfig || {}, roster });
        const loadedTallies = buildStandardTrackerTallies(loadedViewModel.rows.map((row) => row.player), loadedViewModel.columns);
        const loadedOpponentPlayers = buildOpponentPlayers(loadedEvent, linkedOpponentRoster, opponentStats);
        const loadedOpponentViewModel = buildStandardTrackerViewModel({ config: trackerConfig || {}, roster: loadedOpponentPlayers });
        const loadedOpponentTallies = buildStandardTrackerTallies(loadedOpponentViewModel.rows.map((row) => row.player), loadedOpponentViewModel.columns);
        const restoredScore = canRestoreSession ? session?.score || baseScore : baseScore;
        const restoredTallies = canRestoreSession ? session?.tallies || loadedTallies : loadedTallies;
        const restoredOpponentTallies = canRestoreSession ? session?.opponentTallies || loadedOpponentTallies : loadedOpponentTallies;
        const restoredLog = canRestoreSession ? session?.eventLog || [] : [];

        serviceRef.current = createDefaultStatTrackingService({
          statConfig: trackerConfig || {},
          initialScore: restoredScore,
          initialEventLog: restoredLog,
          adjustGameScore: (nextTeamId, nextGameId, nextScoreDelta) => adjustGameScore(nextTeamId, nextGameId, nextScoreDelta, signedInUser)
        });
        setEvent(loadedEvent);
        setConfig(trackerConfig);
        setPlayers(roster);
        setOpponentPlayers(loadedOpponentPlayers);
        setScore(restoredScore);
        setTallies(restoredTallies);
        setOpponentTallies(restoredOpponentTallies);
        setEventLog(restoredLog);
        timer.end({
          canTrack: true,
          playerCount: roster.length,
          opponentPlayerCount: loadedOpponentPlayers.length,
          configPresent: Boolean(trackerConfig),
          restoredSession: canRestoreSession
        });
      } catch (error: any) {
        if (!cancelled) {
          setStatus({ tone: 'error', message: error?.message || 'Unable to load tracker.' });
          setAccessDenied(false);
        }
        timer.end({ error });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTracker();
    return () => {
      cancelled = true;
    };
  }, [auth.user, decodedEventId, decodedTeamId]);

  const viewModel = useMemo(() => buildStandardTrackerViewModel({
    config: config || {},
    roster: players,
    tallies
  }), [config, players, tallies]);

  const opponentViewModel = useMemo(() => buildStandardTrackerViewModel({
    config: config || {},
    roster: opponentPlayers,
    tallies: opponentTallies
  }), [config, opponentPlayers, opponentTallies]);

  const recordCell = async (cell: StandardTrackerCell, options: { isOpponent?: boolean; player?: StandardTrackerPlayer } = {}) => {
    if (!auth.user || !event || !serviceRef.current || savingCellId || undoing) return;
    const isOpponent = options.isOpponent === true;
    const player = options.player;
    if (isOpponent && !player) return;
    const cellId = `${isOpponent ? 'opponent' : 'team'}:${cell.playerId}:${cell.column.key}`;
    setSavingCellId(cellId);
    setStatus(null);
    const timer = startWorkflowTimer(WORKFLOW_TIMING.standardTrackerRecordStat, {
      route: 'standard-tracker',
      side: isOpponent ? 'opponent' : 'team',
      statKey: cell.column.key
    });
    try {
      const playerLabel = getPlayerLabel({ name: cell.playerName, number: cell.playerNumber });
      const nextTallies = isOpponent
        ? tallies
        : applyStandardTrackerTallyDelta(tallies, cell.playerId, cell.column.key, 1);
      const nextOpponentTallies = isOpponent
        ? applyStandardTrackerTallyDelta(opponentTallies, cell.playerId, cell.column.key, 1)
        : opponentTallies;
      const opponentStatsEntryBefore = isOpponent && player
        ? buildStandardTrackerOpponentStatsEntry({
          player,
          columns: opponentViewModel.columns,
          tallies: opponentTallies
        })
        : undefined;
      const opponentStatsEntryAfter = isOpponent && player
        ? buildStandardTrackerOpponentStatsEntry({
          player,
          columns: opponentViewModel.columns,
          tallies: nextOpponentTallies
        })
        : undefined;
      const entry = await serviceRef.current.recordEvent(decodedTeamId, decodedEventId, {
        text: `${isOpponent ? 'Opponent ' : ''}${playerLabel} ${cell.column.label} +1`,
        period: getTrackerPeriod(event),
        timestamp: Date.now(),
        playerName: cell.playerName,
        playerNumber: cell.playerNumber,
        opponentPlayerName: isOpponent ? cell.playerName : undefined,
        opponentPlayerNumber: isOpponent ? cell.playerNumber : undefined,
        opponentPlayerPhoto: isOpponent ? player?.photoUrl || '' : undefined,
        opponentStatsEntryId: isOpponent ? cell.playerId : undefined,
        opponentStatsEntryBefore,
        opponentStatsEntryAfter,
        teamSide: isOpponent ? getOpponentScoreSide(event) : getTeamScoreSide(event),
        undoData: {
          type: 'stat',
          playerId: cell.playerId,
          statKey: cell.column.key,
          value: 1,
          isOpponent
        }
      }, auth.user);
      const nextScore = entry.scoreAfter;
      const nextLog = serviceRef.current.getEventLog();
      setScore(nextScore);
      setTallies(nextTallies);
      setOpponentTallies(nextOpponentTallies);
      setEventLog(nextLog);
      persistSession(nextScore, nextTallies, nextOpponentTallies, nextLog);
      setStatus({ tone: 'success', message: `${isOpponent ? 'Opponent ' : ''}${playerLabel} ${cell.column.label} +1 recorded.` });
      timer.end({
        eventLogCount: nextLog.length,
        scoreChanged: nextScore.homeScore !== score.homeScore || nextScore.awayScore !== score.awayScore
      });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to record stat.' });
      timer.end({ error });
    } finally {
      setSavingCellId(null);
    }
  };

  const undoLast = async () => {
    if (!auth.user || !serviceRef.current || undoing || savingCellId) return;
    setUndoing(true);
    setStatus(null);
    const timer = startWorkflowTimer(WORKFLOW_TIMING.standardTrackerUndoStat, {
      route: 'standard-tracker'
    });
    try {
      const undone = await serviceRef.current.undoLastEvent(decodedTeamId, decodedEventId, auth.user);
      if (!undone) {
        setStatus({ tone: 'info', message: 'No tracker events to undo.' });
        timer.end({ undone: false });
        return;
      }
      const nextScore = undone.scoreBefore;
      const nextTallies = !undone.isOpponent && undone.aggregatePlayerId && undone.aggregateStatKey
        ? applyStandardTrackerTallyDelta(tallies, undone.aggregatePlayerId, undone.aggregateStatKey, -undone.aggregateDelta)
        : tallies;
      const nextOpponentTallies = undone.isOpponent && undone.aggregatePlayerId && undone.aggregateStatKey
        ? applyStandardTrackerTallyDelta(opponentTallies, undone.aggregatePlayerId, undone.aggregateStatKey, -undone.aggregateDelta)
        : opponentTallies;
      const nextLog = serviceRef.current.getEventLog();
      setScore(nextScore);
      setTallies(nextTallies);
      setOpponentTallies(nextOpponentTallies);
      setEventLog(nextLog);
      persistSession(nextScore, nextTallies, nextOpponentTallies, nextLog);
      setStatus({ tone: 'success', message: `Undid ${getLogEntryLabel(undone)}.` });
      timer.end({
        undone: true,
        eventLogCount: nextLog.length
      });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to undo last stat.' });
      timer.end({ error });
    } finally {
      setUndoing(false);
    }
  };

  if (loading) {
    return <EventDetailPageSkeleton />;
  }

  return (
    <div className="space-y-3">
      <Link to={backTarget} className="ghost-button min-h-9 px-3 text-xs">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Game hub
      </Link>

      <section className="app-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-black uppercase tracking-[0.04em] text-primary-700">Standard tracker</div>
            <h1 className="mt-1 text-xl font-black text-gray-950">{event?.opponent ? `vs. ${event.opponent}` : 'Game tracker'}</h1>
            <div className="mt-1 text-sm font-semibold text-gray-500">{event?.teamName || decodedTeamId}</div>
          </div>
          <div className="rounded-2xl bg-gray-950 px-4 py-2 text-right text-white shadow-sm">
            <div className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-300">Score</div>
            <div className="text-3xl font-black tabular-nums">{score.homeScore}-{score.awayScore}</div>
          </div>
        </div>
      </section>

      {status ? <TrackerStatusPanel tone={status.tone} message={status.message} /> : null}

      {!status && accessDenied ? (
        <TrackerStatusPanel tone="error" message="Tracker access is limited to staff scorekeepers for scheduled games." />
      ) : null}

      {!status && !accessDenied && !config ? (
        <TrackerStatusPanel tone="error" message="This game does not have an assigned tracker config." />
      ) : null}

      {!accessDenied && config ? (
        <>
          <section className="app-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">{config.name}</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">{eventLog.length} events</div>
              </div>
              <button
                type="button"
                className="secondary-button min-h-10 px-4 text-sm"
                onClick={() => void undoLast()}
                disabled={undoing || Boolean(savingCellId) || !eventLog.length}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {undoing ? 'Undoing' : 'Undo last'}
              </button>
            </div>
            {viewModel.totals.length ? (
              <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(3, viewModel.totals.length)}, minmax(0, 1fr))` }}>
                {viewModel.totals.map((total) => (
                  <div key={total.key} className="rounded-xl border border-gray-200 bg-gray-50 p-2 text-center">
                    <div className="break-words text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">{total.label}</div>
                    <div className="mt-1 text-2xl font-black tabular-nums text-gray-950">{total.value}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {viewModel.columns.length && viewModel.rows.length ? (
            <section className="space-y-3" data-testid="standard-tracker-grid">
              {viewModel.rows.map((row) => (
                <div key={row.player.id} className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm" data-testid={`standard-tracker-row-${row.player.id}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-black text-gray-950">{getPlayerLabel(row.player)}</div>
                      <div className="text-xs font-semibold text-gray-500">{row.cells.reduce((sum, cell) => sum + cell.value, 0)} tracked stats</div>
                    </div>
                  </div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(3, row.cells.length)}, minmax(0, 1fr))` }}>
                    {row.cells.map((cell) => {
                      const cellId = `team:${cell.playerId}:${cell.column.key}`;
                      const busy = savingCellId === cellId;
                      return (
                        <button
                          key={cell.column.key}
                          type="button"
                          className="min-h-16 rounded-xl border border-gray-200 bg-gray-50 px-2 py-2 text-center transition hover:border-primary-300 hover:bg-primary-50 disabled:opacity-60"
                          onClick={() => void recordCell(cell)}
                          disabled={Boolean(savingCellId) || undoing}
                          aria-label={`${getPlayerLabel(row.player)} ${cell.column.label} add one`}
                        >
                          <span className="block break-words text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">{cell.column.label}</span>
                          <span className="mt-1 block text-lg font-black tabular-nums text-gray-950">{busy ? '...' : `+1 / ${cell.value}`}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ) : (
            <TrackerStatusPanel tone="info" message={viewModel.columns.length ? 'No active roster players found.' : 'No tracker columns found.'} />
          )}

          {opponentViewModel.columns.length && opponentViewModel.rows.length ? (
            <section className="space-y-3" data-testid="standard-tracker-opponent-grid">
              <div className="flex items-center justify-between gap-3 px-1">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.04em] text-rose-700">Opponent</div>
                  <div className="text-sm font-semibold text-gray-500">{getOpponentName(event)}</div>
                </div>
                {opponentViewModel.totals.length ? (
                  <div className="text-right text-xs font-black uppercase tracking-[0.04em] text-gray-500">
                    {opponentViewModel.totals.map((total) => `${total.label} ${total.value}`).join(' / ')}
                  </div>
                ) : null}
              </div>
              {opponentViewModel.rows.map((row) => (
                <div key={row.player.id} className="rounded-2xl border border-rose-100 bg-white p-3 shadow-sm" data-testid={`standard-tracker-opponent-row-${row.player.id}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-black text-gray-950">{getPlayerLabel(row.player)}</div>
                      <div className="text-xs font-semibold text-gray-500">{row.cells.reduce((sum, cell) => sum + cell.value, 0)} tracked stats</div>
                    </div>
                  </div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(3, row.cells.length)}, minmax(0, 1fr))` }}>
                    {row.cells.map((cell) => {
                      const cellId = `opponent:${cell.playerId}:${cell.column.key}`;
                      const busy = savingCellId === cellId;
                      return (
                        <button
                          key={cell.column.key}
                          type="button"
                          className="min-h-16 rounded-xl border border-rose-100 bg-rose-50 px-2 py-2 text-center transition hover:border-rose-300 hover:bg-rose-100 disabled:opacity-60"
                          onClick={() => void recordCell(cell, { isOpponent: true, player: row.player })}
                          disabled={Boolean(savingCellId) || undoing}
                          aria-label={`Opponent ${getPlayerLabel(row.player)} ${cell.column.label} add one`}
                        >
                          <span className="block break-words text-[11px] font-black uppercase tracking-[0.04em] text-rose-700">{cell.column.label}</span>
                          <span className="mt-1 block text-lg font-black tabular-nums text-gray-950">{busy ? '...' : `+1 / ${cell.value}`}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function TrackerStatusPanel({ tone, message }: TrackerStatus) {
  const className = tone === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-gray-200 bg-gray-50 text-gray-700';
  return (
    <div role="status" aria-live="polite" className={`rounded-2xl border px-4 py-3 text-sm font-bold ${className}`}>
      {message}
    </div>
  );
}

export { getLogEntryLabel };
export type { TrackerStatus, StandardTrackerColumn };
