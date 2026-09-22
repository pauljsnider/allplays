import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, RefreshCw } from 'lucide-react';
import { loadGameReportPlays, loadGameReportSections, type GameReportData } from '../../lib/gameReportService';
import { exportDiamondGameReportStatsCsv } from '../../lib/diamondStatExport';
import type { ParentScheduleEvent } from '../../lib/scheduleLogic';
import { GameReportSectionContent, getRecordedTeamStatKeys, type GameReportSectionId } from './GameReportSectionContent';

const gameReportSections: Array<{ id: GameReportSectionId; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'players', label: 'Players' },
  { id: 'plays', label: 'Plays' },
  { id: 'opponent', label: 'Opponent' },
  { id: 'insights', label: 'Insights' },
  { id: 'media', label: 'Media' }
];

const liveReportStatuses = new Set(['live', 'in_progress', 'in-progress', 'halftime']);
const terminalReportStatuses = new Set(['final', 'completed', 'complete', 'cancelled', 'canceled', 'deleted']);
const liveReportPollIntervalMs = 15000;

export function GameReportSections({ event, onRefreshEvent }: { event: ParentScheduleEvent; onRefreshEvent?: () => Promise<void> | void }) {
  const [activeReportSection, setActiveReportSection] = useState<GameReportSectionId>('summary');
  const [report, setReport] = useState<GameReportData | null>(null);
  const [loadingReport, setLoadingReport] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [exportingReport, setExportingReport] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [refreshingEventIdentity, setRefreshingEventIdentity] = useState(false);
  const [reportNeedsEventRefresh, setReportNeedsEventRefresh] = useState(false);
  const reportRequestGeneration = useRef(0);
  const livePlaysRequestGeneration = useRef(0);
  const requestedStatVisibility = event.isTeamAdmin || event.isTeamStaff || event.canUpdateScore ? 'manager-internal' : 'public';
  const eventDiamondInstanceId = String(event.diamondScorebookInstanceId || '').trim();
  const eventExpectsDiamond = eventDiamondInstanceId !== '' || isDiamondTrackingEngine(event.trackingEngine);
  const eventReportLoadStatus = normalizeGameReportLoadStatus(event.liveStatus, event.status);
  const reportScopeKey = `${event.teamId}\u0000${event.id}\u0000${eventExpectsDiamond ? 'diamond' : 'legacy'}\u0000${eventDiamondInstanceId}\u0000${requestedStatVisibility}\u0000${eventReportLoadStatus}`;
  const latestReportScope = useRef(reportScopeKey);
  latestReportScope.current = reportScopeKey;
  const displayedReport =
    report &&
    isReportCurrentForEvent(report, event.teamId, event.id, eventExpectsDiamond, eventDiamondInstanceId) &&
    isReportSafeForVisibility(report, requestedStatVisibility)
      ? report
      : null;
  const visibleReportSections = useMemo(() => getVisibleGameReportSections(displayedReport), [displayedReport]);
  const currentReportStatuses = (
    displayedReport ? [displayedReport.game?.liveStatus, displayedReport.game?.status] : [event.liveStatus, event.status]
  ).map((status) =>
    String(status || '')
      .trim()
      .toLowerCase()
  );
  const eventReportStatuses = [event.liveStatus, event.status].map((status) =>
    String(status || '')
      .trim()
      .toLowerCase()
  );
  const isLivePlaysRefreshEnabled =
    activeReportSection === 'plays' &&
    !eventReportStatuses.some((status) => terminalReportStatuses.has(status)) &&
    !currentReportStatuses.some((status) => terminalReportStatuses.has(status)) &&
    currentReportStatuses.some((status) => liveReportStatuses.has(status));

  const refreshReport = useCallback(
    async (showLoading = true) => {
      const requestGeneration = ++reportRequestGeneration.current;
      const requestScope = reportScopeKey;
      setReportNeedsEventRefresh(false);
      if (requestedStatVisibility === 'public') {
        setReport((current) => (current && isReportSafeForVisibility(current, requestedStatVisibility) ? current : null));
        setExportMessage('');
      }
      if (showLoading) setLoadingReport(true);
      setReportError(null);
      try {
        const loaded = await loadGameReportSections(event.teamId, event.id, {
          statVisibility: requestedStatVisibility
        });
        if (requestGeneration !== reportRequestGeneration.current || requestScope !== latestReportScope.current) return;
        if (!isReportCurrentForEvent(loaded, event.teamId, event.id, eventExpectsDiamond, eventDiamondInstanceId)) {
          setReport(null);
          setReportNeedsEventRefresh(hasDiamondGenerationMismatch(loaded, eventExpectsDiamond, eventDiamondInstanceId));
          setReportError('The game report identity changed while loading. Retry the report.');
          return;
        }
        setReport(loaded);
      } catch (error: any) {
        if (requestGeneration !== reportRequestGeneration.current || requestScope !== latestReportScope.current) return;
        setReportError(error?.message || 'Unable to load game report.');
      } finally {
        if (showLoading && requestGeneration === reportRequestGeneration.current && requestScope === latestReportScope.current)
          setLoadingReport(false);
      }
    },
    [event.id, event.teamId, eventDiamondInstanceId, eventExpectsDiamond, reportScopeKey, requestedStatVisibility]
  );

  const refreshLivePlays = useCallback(async () => {
    const requestGeneration = ++livePlaysRequestGeneration.current;
    const requestScope = reportScopeKey;
    try {
      const refresh = await loadGameReportPlays(event.teamId, event.id, {
        statVisibility: requestedStatVisibility
      });
      if (requestGeneration !== livePlaysRequestGeneration.current || requestScope !== latestReportScope.current) return;
      if (
        (refresh.game.id && refresh.game.id !== event.id) ||
        (refresh.replay && refresh.replay.requestedVisibility !== requestedStatVisibility)
      ) {
        setReportError('Play-by-play refresh returned mismatched report evidence. Retry the report.');
        return;
      }
      const currentReportInstanceId = String(report?.game?.diamondScorebookInstanceId || '').trim();
      const refreshInstanceId = String(refresh.game?.diamondScorebookInstanceId || '').trim();
      const currentReportExpectsDiamond = Boolean(
        report?.diamond?.isDiamond || currentReportInstanceId || isDiamondTrackingEngine(report?.game?.trackingEngine)
      );
      const refreshExpectsDiamond = Boolean(refresh.replay || refreshInstanceId || isDiamondTrackingEngine(refresh.game?.trackingEngine));
      if (
        (currentReportExpectsDiamond || refreshExpectsDiamond) &&
        (!currentReportExpectsDiamond ||
          !refreshExpectsDiamond ||
          !currentReportInstanceId ||
          !refreshInstanceId ||
          currentReportInstanceId !== refreshInstanceId)
      ) {
        setReport(null);
        setReportNeedsEventRefresh(true);
        setReportError('This Diamond scorebook was recreated. Retry the report.');
        return;
      }
      setReport((currentReport) =>
        currentReport &&
        isReportCurrentForEvent(currentReport, event.teamId, event.id, eventExpectsDiamond, eventDiamondInstanceId) &&
        isReportSafeForVisibility(currentReport, requestedStatVisibility)
          ? {
              ...currentReport,
              game: { ...currentReport.game, ...refresh.game },
              plays: refresh.playsFresh !== false ? refresh.plays : currentReport.plays,
              ...(currentReport.diamond && refresh.replay
                ? {
                    diamond: {
                      ...currentReport.diamond,
                      requestedReplayVisibility: refresh.replay.requestedVisibility,
                      replayVisibility: refresh.replay.visibility,
                      replaySource: refresh.replay.source
                    }
                  }
                : {})
            }
          : currentReport
      );
      if (refresh.replayError) {
        setReportError(refresh.replayError);
      } else if (refresh.playsFresh !== false) {
        setReportError(null);
      }
      const refreshedStatuses = [refresh.game?.liveStatus, refresh.game?.status].map((status) =>
        String(status || '')
          .trim()
          .toLowerCase()
      );
      if (refreshedStatuses.some((status) => terminalReportStatuses.has(status))) {
        await refreshReport(false);
      }
    } catch (error: any) {
      if (requestGeneration !== livePlaysRequestGeneration.current || requestScope !== latestReportScope.current) return;
      setReportError(error?.message || 'Unable to refresh play-by-play.');
    }
  }, [event.id, event.teamId, eventDiamondInstanceId, eventExpectsDiamond, refreshReport, report, reportScopeKey, requestedStatVisibility]);

  useEffect(() => {
    reportRequestGeneration.current += 1;
    livePlaysRequestGeneration.current += 1;
    setReport(null);
    setActiveReportSection('summary');
    setExportMessage('');
    setRefreshingEventIdentity(false);
    setReportNeedsEventRefresh(false);
  }, [event.id, event.teamId, eventDiamondInstanceId]);

  useEffect(() => {
    reportRequestGeneration.current += 1;
    livePlaysRequestGeneration.current += 1;
    if (requestedStatVisibility === 'public') {
      setReport((current) => (current && isReportSafeForVisibility(current, requestedStatVisibility) ? current : null));
      setExportMessage('');
    }
  }, [event.id, event.teamId, eventDiamondInstanceId, requestedStatVisibility]);

  useEffect(() => {
    void refreshReport();
  }, [event.id, event.teamId, eventReportLoadStatus, refreshReport]);

  const retryReport = useCallback(async () => {
    if (!reportNeedsEventRefresh || !onRefreshEvent) {
      await refreshReport();
      return;
    }
    const recoveryScope = reportScopeKey;
    setRefreshingEventIdentity(true);
    try {
      await onRefreshEvent();
    } catch (error: any) {
      if (recoveryScope === latestReportScope.current) {
        setReportError(error?.message || 'Unable to refresh the game before retrying the report.');
      }
    } finally {
      if (recoveryScope === latestReportScope.current) setRefreshingEventIdentity(false);
    }
  }, [onRefreshEvent, refreshReport, reportNeedsEventRefresh, reportScopeKey]);

  const exportDiamondReport = useCallback(async () => {
    if (!displayedReport?.diamond?.isDiamond || exportingReport) return;
    setExportingReport(true);
    setExportMessage('');
    try {
      const result = await exportDiamondGameReportStatsCsv(displayedReport);
      setExportMessage(result === 'shared' ? 'Stats CSV ready to share.' : 'Stats CSV downloaded.');
    } catch (error: any) {
      setExportMessage(error?.message || 'Unable to export stats CSV.');
    } finally {
      setExportingReport(false);
    }
  }, [displayedReport, exportingReport]);

  useEffect(() => {
    if (!isLivePlaysRefreshEnabled) return undefined;
    const intervalId = window.setInterval(() => {
      void refreshLivePlays();
    }, liveReportPollIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [isLivePlaysRefreshEnabled, refreshLivePlays]);

  useEffect(() => {
    if (!isLivePlaysRefreshEnabled) return undefined;
    const handleFocus = () => {
      void refreshLivePlays();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isLivePlaysRefreshEnabled, refreshLivePlays]);

  useEffect(() => {
    if (visibleReportSections.some((section) => section.id === activeReportSection)) return;
    setActiveReportSection('summary');
  }, [activeReportSection, visibleReportSections]);

  return (
    <div className="app-card overflow-hidden p-0">
      <div className="border-b border-gray-100 px-3 py-3 sm:px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-gray-950">Report sections</h3>
            <div className="mt-0.5 text-xs font-semibold text-gray-500">Loaded from the same report data as game.html.</div>
          </div>
          <div className="flex flex-none items-center gap-2">
            {displayedReport?.diamond?.isDiamond ? (
              <button
                type="button"
                className="border-primary-200 bg-primary-50 text-primary-700 inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  void exportDiamondReport();
                }}
                disabled={exportingReport}
              >
                {exportingReport ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {exportingReport
                  ? 'Preparing CSV'
                  : displayedReport.diamond.statVisibility === 'manager-internal'
                    ? 'Export internal CSV'
                    : 'Export public CSV'}
              </button>
            ) : null}
            {loadingReport ? <RefreshCw className="text-primary-600 mt-0.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          </div>
        </div>
        {exportMessage ? (
          <div className="mt-2 text-xs font-semibold text-gray-600" role="status">
            {exportMessage}
          </div>
        ) : null}
      </div>

      <div className="border-b border-gray-100 px-2 py-2">
        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {visibleReportSections.map((section) => {
            const active = section.id === activeReportSection;
            return (
              <button
                key={section.id}
                type="button"
                aria-pressed={active}
                className={`min-h-11 flex-none rounded-full px-4 text-xs font-black transition ${
                  active ? 'bg-primary-600 text-white shadow-sm' : 'hover:bg-primary-50 hover:text-primary-700 bg-gray-50 text-gray-600'
                }`}
                onClick={() => setActiveReportSection(section.id)}
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-3 sm:p-4">
        <div className="space-y-3">
          {loadingReport ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">
              Loading report sections...
            </div>
          ) : null}
          {reportError ? (
            <Status
              tone="error"
              message={reportError}
              retrying={loadingReport || refreshingEventIdentity}
              onRetry={() => {
                void retryReport();
              }}
            />
          ) : null}
          {displayedReport ? <GameReportSectionContent report={displayedReport} activeSection={activeReportSection} /> : null}
        </div>
      </div>
    </div>
  );
}

function hasOpponentReportData(report: GameReportData) {
  return report.opponentRows.length > 0 && report.opponentStatKeys.length > 0;
}

function hasInsightReportData(report: GameReportData) {
  return Boolean(report.publishedAiRecap) || report.teamInsights.length > 0 || report.playerInsightRows.length > 0;
}

function hasMediaReportData(report: GameReportData) {
  return (report.highlightClips?.length || 0) > 0 || Boolean(report.statSheetPhotoUrl) || getRecordedTeamStatKeys(report).length > 0;
}

function shouldShowPlayByPlaySection(report: GameReportData) {
  const liveStatus = String(report.game?.liveStatus || report.game?.status || '')
    .trim()
    .toLowerCase();
  return report.plays.length > 0 || liveReportStatuses.has(liveStatus);
}

function normalizeGameReportLoadStatus(...statuses: unknown[]) {
  const normalized = statuses.map((status) =>
    String(status || '')
      .trim()
      .toLowerCase()
  );
  if (normalized.some((status) => terminalReportStatuses.has(status))) return 'terminal';
  if (normalized.some((status) => liveReportStatuses.has(status))) return 'live';
  const firstStatus = normalized.find(Boolean) || '';
  if (!firstStatus || firstStatus === 'scheduled') return 'scheduled';
  return firstStatus;
}

function isReportCurrentForEvent(
  report: GameReportData,
  teamId: string,
  gameId: string,
  eventExpectsDiamond: boolean,
  eventDiamondInstanceId: string
) {
  if (report.team?.id !== teamId || report.game?.id !== gameId) return false;
  const reportDiamondInstanceId = String(report.game?.diamondScorebookInstanceId || '').trim();
  const reportExpectsDiamond = Boolean(
    report.diamond?.isDiamond || reportDiamondInstanceId || isDiamondTrackingEngine(report.game?.trackingEngine)
  );
  if (!eventExpectsDiamond && !reportExpectsDiamond) return true;
  return Boolean(
    eventExpectsDiamond &&
    reportExpectsDiamond &&
    report.diamond?.isDiamond &&
    eventDiamondInstanceId &&
    reportDiamondInstanceId === eventDiamondInstanceId
  );
}

function hasDiamondGenerationMismatch(report: GameReportData, eventExpectsDiamond: boolean, eventDiamondInstanceId: string) {
  const reportDiamondInstanceId = String(report.game?.diamondScorebookInstanceId || '').trim();
  const reportExpectsDiamond = Boolean(
    report.diamond?.isDiamond || reportDiamondInstanceId || isDiamondTrackingEngine(report.game?.trackingEngine)
  );
  if (!eventExpectsDiamond && !reportExpectsDiamond) return false;
  return (
    !eventExpectsDiamond ||
    !reportExpectsDiamond ||
    !eventDiamondInstanceId ||
    !reportDiamondInstanceId ||
    eventDiamondInstanceId !== reportDiamondInstanceId
  );
}

function isDiamondTrackingEngine(value: unknown) {
  return (
    String(value || '')
      .trim()
      .toLowerCase() === 'diamond-v2'
  );
}

function isReportSafeForVisibility(report: GameReportData, requestedVisibility: 'public' | 'manager-internal') {
  if (requestedVisibility === 'manager-internal' || !report.diamond?.isDiamond) return true;
  return [
    report.diamond.requestedStatVisibility,
    report.diamond.statVisibility,
    report.diamond.requestedReplayVisibility,
    report.diamond.replayVisibility
  ].every((visibility) => visibility !== 'manager-internal');
}

function getVisibleGameReportSections(report: GameReportData | null) {
  if (!report) {
    return gameReportSections.filter((section) => section.id === 'summary' || section.id === 'players' || section.id === 'plays');
  }
  return gameReportSections.filter((section) => {
    if (section.id === 'summary' || section.id === 'players') return true;
    if (section.id === 'plays') return shouldShowPlayByPlaySection(report);
    if (section.id === 'opponent') return hasOpponentReportData(report);
    if (section.id === 'insights') return hasInsightReportData(report);
    if (section.id === 'media') return hasMediaReportData(report);
    return false;
  });
}

function Status({
  tone,
  message,
  onRetry,
  retrying = false
}: {
  tone: 'success' | 'error';
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const isError = tone === 'error';
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
      role={isError ? 'alert' : 'status'}
    >
      {isError ? (
        <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <div>{message}</div>
        {onRetry ? (
          <button
            type="button"
            className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 text-xs font-black text-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onRetry}
            disabled={retrying}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
            {retrying ? 'Retrying report' : 'Retry report'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
