import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, RotateCcw } from 'lucide-react';
import {
  loadHomeScoringPlayers,
  loadParentScheduleEventDetail,
  loadScheduleStatTrackerConfigsForApp,
  updateGameScore,
  type ScheduleHomeScoringPlayer,
  type ScheduleStatTrackerConfigOption
} from '../lib/scheduleService';
import { type ParentScheduleEvent } from '../lib/scheduleLogic';
import { createDefaultStatTrackingService, type TrackerLogEntry, type TrackerScoreState } from '../lib/statTrackingService';
import {
  applyStandardTrackerTallyDelta,
  buildStandardTrackerTallies,
  buildStandardTrackerViewModel,
  type StandardTrackerCell,
  type StandardTrackerColumn,
  type StandardTrackerTallies
} from '../lib/standardTrackerViewModel';
import { readStandardTrackerSession, writeStandardTrackerSession } from '../lib/standardTrackerSession';
import { EventDetailPageSkeleton } from '../components/PageSkeletons';
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

function getTrackerPeriod(event: ParentScheduleEvent | null) {
  return String(event?.liveClockPeriod || (event as Record<string, unknown> | null)?.period || 'Q1');
}

function getPlayerLabel(player: { name: string; number?: string | null }) {
  return `${player.number ? `#${player.number} ` : ''}${player.name}`;
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
  const [score, setScore] = useState<TrackerScoreState>({ homeScore: 0, awayScore: 0 });
  const [tallies, setTallies] = useState<StandardTrackerTallies>({});
  const [eventLog, setEventLog] = useState<TrackerLogEntry[]>([]);
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCellId, setSavingCellId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const serviceRef = useRef<TrackerService | null>(null);

  const backTarget = `/schedule/${encodeURIComponent(decodedTeamId)}/${encodeURIComponent(decodedEventId)}?section=game`;

  const persistSession = useCallback((nextScore: TrackerScoreState, nextTallies: StandardTrackerTallies, nextLog: TrackerLogEntry[]) => {
    writeStandardTrackerSession({
      teamId: decodedTeamId,
      gameId: decodedEventId,
      statTrackerConfigId: config?.id || event?.statTrackerConfigId || null,
      score: nextScore,
      tallies: nextTallies,
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

      try {
        const detail = await loadParentScheduleEventDetail(signedInUser, { teamId: decodedTeamId, eventId: decodedEventId });
        if (cancelled) return;
        const loadedEvent = detail.events.find((candidate) => candidate.teamId === decodedTeamId && candidate.id === decodedEventId) || detail.events[0] || null;
        const canTrack = Boolean(loadedEvent && loadedEvent.type === 'game' && loadedEvent.isDbGame && !loadedEvent.isCancelled && loadedEvent.canUpdateScore);
        if (!canTrack) {
          setEvent(loadedEvent);
          setConfig(null);
          setPlayers([]);
          setTallies({});
          setEventLog([]);
          setAccessDenied(true);
          return;
        }

        const [configs, roster] = await Promise.all([
          loadScheduleStatTrackerConfigsForApp(decodedTeamId, signedInUser),
          loadHomeScoringPlayers(decodedTeamId, decodedEventId)
        ]);
        if (cancelled) return;

        const trackerConfig = configs.find((candidate) => candidate.id === loadedEvent.statTrackerConfigId) || null;
        const baseScore = getSavedScore(loadedEvent);
        const session = readStandardTrackerSession(decodedTeamId, decodedEventId, trackerConfig?.id || loadedEvent.statTrackerConfigId || null);
        const loadedViewModel = buildStandardTrackerViewModel({ config: trackerConfig || {}, roster });
        const loadedTallies = buildStandardTrackerTallies(loadedViewModel.rows.map((row) => row.player), loadedViewModel.columns);
        const restoredScore = session?.score || baseScore;
        const restoredTallies = session?.tallies || loadedTallies;
        const restoredLog = session?.eventLog || [];

        serviceRef.current = createDefaultStatTrackingService({
          statConfig: trackerConfig || {},
          initialScore: restoredScore,
          initialEventLog: restoredLog,
          updateGameScore: (nextTeamId, nextGameId, nextScore) => updateGameScore(nextTeamId, nextGameId, nextScore, signedInUser)
        });
        setEvent(loadedEvent);
        setConfig(trackerConfig);
        setPlayers(roster);
        setScore(restoredScore);
        setTallies(restoredTallies);
        setEventLog(restoredLog);
      } catch (error: any) {
        if (!cancelled) {
          setStatus({ tone: 'error', message: error?.message || 'Unable to load tracker.' });
          setAccessDenied(false);
        }
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

  const recordCell = async (cell: StandardTrackerCell) => {
    if (!auth.user || !event || !serviceRef.current || savingCellId || undoing) return;
    const cellId = `${cell.playerId}:${cell.column.key}`;
    setSavingCellId(cellId);
    setStatus(null);
    try {
      const playerLabel = getPlayerLabel({ name: cell.playerName, number: cell.playerNumber });
      const entry = await serviceRef.current.recordEvent(decodedTeamId, decodedEventId, {
        text: `${playerLabel} ${cell.column.label} +1`,
        period: getTrackerPeriod(event),
        timestamp: Date.now(),
        playerName: cell.playerName,
        playerNumber: cell.playerNumber,
        teamSide: event.isHome === false ? 'away' : 'home',
        undoData: {
          type: 'stat',
          playerId: cell.playerId,
          statKey: cell.column.key,
          value: 1,
          isOpponent: false
        }
      }, auth.user);
      const nextScore = entry.scoreAfter;
      const nextTallies = applyStandardTrackerTallyDelta(tallies, cell.playerId, cell.column.key, 1);
      const nextLog = serviceRef.current.getEventLog();
      setScore(nextScore);
      setTallies(nextTallies);
      setEventLog(nextLog);
      persistSession(nextScore, nextTallies, nextLog);
      setStatus({ tone: 'success', message: `${playerLabel} ${cell.column.label} +1 recorded.` });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to record stat.' });
    } finally {
      setSavingCellId(null);
    }
  };

  const undoLast = async () => {
    if (!auth.user || !serviceRef.current || undoing || savingCellId) return;
    setUndoing(true);
    setStatus(null);
    try {
      const undone = await serviceRef.current.undoLastEvent(decodedTeamId, decodedEventId, auth.user);
      if (!undone) {
        setStatus({ tone: 'info', message: 'No tracker events to undo.' });
        return;
      }
      const nextScore = undone.scoreBefore;
      const nextTallies = undone.aggregatePlayerId && undone.aggregateStatKey
        ? applyStandardTrackerTallyDelta(tallies, undone.aggregatePlayerId, undone.aggregateStatKey, -undone.aggregateDelta)
        : tallies;
      const nextLog = serviceRef.current.getEventLog();
      setScore(nextScore);
      setTallies(nextTallies);
      setEventLog(nextLog);
      persistSession(nextScore, nextTallies, nextLog);
      setStatus({ tone: 'success', message: `Undid ${getLogEntryLabel(undone)}.` });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to undo last stat.' });
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
                      const cellId = `${cell.playerId}:${cell.column.key}`;
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
