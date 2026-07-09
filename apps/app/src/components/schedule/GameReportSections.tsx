import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { loadGameReportPlays, loadGameReportSections, type GameReportData } from '../../lib/gameReportService';
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
const completedReportStatuses = new Set(['final', 'completed', 'complete']);
const liveReportPollIntervalMs = 15000;

export function GameReportSections({ event }: { event: ParentScheduleEvent }) {
  const [activeReportSection, setActiveReportSection] = useState<GameReportSectionId>('summary');
  const [report, setReport] = useState<GameReportData | null>(null);
  const [loadingReport, setLoadingReport] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const visibleReportSections = useMemo(() => getVisibleGameReportSections(report), [report]);
  const currentReportStatuses = (report
    ? [report.game?.liveStatus, report.game?.status]
    : [event.liveStatus, event.status]
  ).map((status) => String(status || '').trim().toLowerCase());
  const eventReportLoadStatus = normalizeGameReportLoadStatus(event.liveStatus || event.status);
  const isLivePlaysRefreshEnabled = activeReportSection === 'plays'
    && !currentReportStatuses.some((status) => completedReportStatuses.has(status))
    && currentReportStatuses.some((status) => liveReportStatuses.has(status));

  const refreshReport = useCallback(async (showLoading = true) => {
    if (showLoading) setLoadingReport(true);
    setReportError(null);
    try {
      const loaded = await loadGameReportSections(event.teamId, event.id);
      setReport(loaded);
    } catch (error: any) {
      setReportError(error?.message || 'Unable to load game report.');
    } finally {
      if (showLoading) setLoadingReport(false);
    }
  }, [event.id, event.teamId]);

  const refreshLivePlays = useCallback(async () => {
    setReportError(null);
    try {
      const refresh = await loadGameReportPlays(event.teamId, event.id);
      setReport((currentReport) => currentReport ? {
        ...currentReport,
        game: { ...currentReport.game, ...refresh.game },
        plays: refresh.playsFresh ? refresh.plays : currentReport.plays
      } : currentReport);
      const refreshedStatuses = [refresh.game?.liveStatus, refresh.game?.status]
        .map((status) => String(status || '').trim().toLowerCase());
      if (refreshedStatuses.some((status) => completedReportStatuses.has(status))) {
        await refreshReport(false);
      }
    } catch (error: any) {
      setReportError(error?.message || 'Unable to refresh play-by-play.');
    }
  }, [event.id, event.teamId, refreshReport]);

  useEffect(() => {
    setReport(null);
    setActiveReportSection('summary');
    void refreshReport();
  }, [event.id, event.teamId, eventReportLoadStatus, refreshReport]);

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
          {loadingReport ? <RefreshCw className="mt-0.5 h-4 w-4 flex-none animate-spin text-primary-600" aria-hidden="true" /> : null}
        </div>
      </div>

      <div className="border-b border-gray-100 px-2 py-2">
        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {visibleReportSections.map((section) => {
            const active = section.id === activeReportSection;
            return (
              <button
                key={section.id}
                type="button"
                className={`min-h-8 flex-none rounded-full px-3 text-xs font-black transition ${
                  active ? 'bg-primary-600 text-white shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-primary-50 hover:text-primary-700'
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
        {loadingReport ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">Loading report sections...</div>
        ) : reportError ? (
          <Status tone="error" message={reportError} />
        ) : report ? (
          <GameReportSectionContent report={report} activeSection={activeReportSection} />
        ) : null}
      </div>
    </div>
  );
}

function hasOpponentReportData(report: GameReportData) {
  return report.opponentRows.length > 0 && report.opponentStatKeys.length > 0;
}

function hasInsightReportData(report: GameReportData) {
  return report.teamInsights.length > 0 || report.playerInsightRows.length > 0;
}

function hasMediaReportData(report: GameReportData) {
  return (report.highlightClips?.length || 0) > 0
    || Boolean(report.statSheetPhotoUrl)
    || getRecordedTeamStatKeys(report).length > 0;
}

function shouldShowPlayByPlaySection(report: GameReportData) {
  const liveStatus = String(report.game?.liveStatus || report.game?.status || '').trim().toLowerCase();
  return report.plays.length > 0 || liveReportStatuses.has(liveStatus);
}

function normalizeGameReportLoadStatus(status: unknown) {
  const normalized = String(status || '').trim().toLowerCase();
  if (liveReportStatuses.has(normalized)) return 'live';
  if (completedReportStatuses.has(normalized)) return 'completed';
  if (!normalized || normalized === 'scheduled') return 'scheduled';
  return normalized;
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

function Status({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  const isError = tone === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      {isError ? <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />}
      {message}
    </div>
  );
}
