import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useLiveGameAnnouncer } from '../../lib/liveGameAnnouncer';
import { getPublicPlayerHref } from '../../lib/scheduleHub';
import type { GameReportData, GameReportInsight, GameReportPlay, GameReportPlayerRow } from '../../lib/gameReportService';
import { ReportMarkdownText } from './ReportMarkdownText';

export type GameReportSectionId = 'summary' | 'players' | 'plays' | 'opponent' | 'insights' | 'media';

export function GameReportSectionContent({ report, activeSection }: { report: GameReportData; activeSection: GameReportSectionId }) {
  if (activeSection === 'players') return <PlayerPerformanceSection report={report} />;
  if (activeSection === 'plays') return <PlayByPlaySection plays={report.plays} />;
  if (activeSection === 'opponent') return <OpponentStatsSection report={report} />;
  if (activeSection === 'insights') return <ReportInsightsSection report={report} />;
  if (activeSection === 'media') return <ReportMediaSection report={report} />;
  return <MatchSummarySection report={report} />;
}

function MatchSummarySection({ report }: { report: GameReportData }) {
  const score = getReportScoreLabel(report.game);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <DetailRow label="Result" value={getReportResultLabel(report.game)} />
        <DetailRow label="Score" value={score || 'TBD'} />
        <DetailRow label="Plays" value={String(report.plays.length)} />
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Match Summary</div>
        {report.summary ? (
          <ReportMarkdownText text={report.summary} />
        ) : (
          <p className="mt-2 text-sm font-semibold text-gray-500">No summary available yet.</p>
        )}
      </div>
    </div>
  );
}

function PlayerPerformanceSection({ report }: { report: GameReportData }) {
  const [showFullRoster, setShowFullRoster] = useState(false);
  const statKeys = report.statKeys.slice(0, 4);
  const playerRows = Array.isArray(report.playerRows) ? report.playerRows : [];
  const visiblePlayerRows = Array.isArray(report.visiblePlayerRows) ? report.visiblePlayerRows : [];
  const deferredPlayerRows = Array.isArray(report.deferredPlayerRows) ? report.deferredPlayerRows : [];
  const visiblePlayers = visiblePlayerRows.length ? visiblePlayerRows : playerRows;
  const deferredPlayers = deferredPlayerRows;

  if (!playerRows.length) {
    return <EmptyReportState title="No players found" detail="Player performance will appear after roster and stats load." />;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-1 text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">
        <span>Player</span>
        <span>Stats</span>
      </div>
      {visiblePlayers.map((player) => (
        <PlayerPerformanceRow
          key={player.playerId}
          player={player}
          statKeys={statKeys}
          statLabels={report.statLabels}
          hasPlayingTime={report.hasPlayingTime}
          teamId={report.team.id || ''}
          gameId={report.game.id || ''}
        />
      ))}
      {deferredPlayers.length ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            onClick={() => setShowFullRoster((current) => !current)}
            aria-expanded={showFullRoster}
            aria-label={showFullRoster ? 'Hide full roster' : `Show full roster (${deferredPlayers.length})`}
          >
            <div>
              <div className="text-sm font-black text-gray-950">Other rostered players</div>
              <div className="mt-0.5 text-xs font-semibold text-gray-500">Show the full roster, including players without participation records for this game.</div>
            </div>
            <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-black text-gray-700">
              {showFullRoster ? 'Hide full roster' : `Show full roster (${deferredPlayers.length})`}
            </span>
          </button>
          {showFullRoster ? (
            <div className="mt-3 space-y-2">
              {deferredPlayers.map((player) => (
                <PlayerPerformanceRow
                  key={player.playerId}
                  player={player}
                  statKeys={statKeys}
                  statLabels={report.statLabels}
                  hasPlayingTime={report.hasPlayingTime}
                  teamId={report.team.id || ''}
                  gameId={report.game.id || ''}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PlayerPerformanceRow({ player, statKeys, statLabels, hasPlayingTime, teamId, gameId }: {
  player: GameReportPlayerRow;
  statKeys: string[];
  statLabels: Record<string, string>;
  hasPlayingTime: boolean;
  teamId: string;
  gameId: string;
}) {
  return (
    <a href={getPublicPlayerHref(teamId, gameId, player.playerId)} className="block rounded-xl border border-gray-200 bg-white p-3 transition hover:border-primary-200 hover:bg-primary-50">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full bg-gray-100 text-sm font-black text-gray-500">
            {player.photoUrl ? <img src={player.photoUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : player.playerName.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-gray-950">#{player.number} {player.playerName}</div>
            <div className="mt-0.5 flex items-center gap-2 text-xs font-semibold text-gray-500">
              {player.didNotPlay ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800">DNP</span> : null}
              {hasPlayingTime && !player.didNotPlay ? <span>{formatDuration(player.timeMs)} min</span> : null}
            </div>
          </div>
        </div>
        <div className="flex flex-none flex-wrap justify-end gap-1.5">
          {statKeys.map((key) => (
            <span key={key} className="min-w-11 rounded-lg bg-gray-50 px-2 py-1 text-center">
              <span className="block text-[10px] font-black uppercase text-gray-400">{statLabels[key] || key.toUpperCase()}</span>
              <span className="block text-sm font-black tabular-nums text-gray-900">{player.didNotPlay ? '-' : String(player.stats[key] || 0)}</span>
            </span>
          ))}
        </div>
      </div>
    </a>
  );
}

function PlayByPlaySection({ plays }: { plays: GameReportPlay[] }) {
  const { supported, enabled, paused, toggleEnabled } = useLiveGameAnnouncer(plays);

  if (!plays.length) {
    return <EmptyReportState title="No events logged" detail="Play-by-play will appear here during or after the game." />;
  }

  return (
    <div className="space-y-3">
      <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1" aria-label="Play-by-play log">
        {plays.map((play) => (
          <div key={play.id || `${play.period}-${play.clock}-${play.text}`} className="rounded-r-xl border-l-4 border-primary-500 bg-gray-50 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 inline-flex min-h-6 flex-none items-center rounded-md bg-primary-600 px-2 text-[11px] font-black text-white">{play.period}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold leading-5 text-gray-900">{play.text}</div>
                <div className="mt-1 flex gap-2 text-xs font-semibold text-gray-500">
                  {play.clock ? <span className="font-mono">{play.clock}</span> : null}
                  {play.timestamp ? <span>{formatReportTime(play.timestamp)}</span> : null}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3" aria-label="Play-by-play audio controls">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-700">Audio announcements</div>
            <div className="text-xs font-semibold text-gray-500">
              {supported
                ? paused
                  ? 'Announcements pause automatically when the game is backgrounded.'
                  : 'Hear each new play once while you keep this game open.'
                : 'Audio announcements are not supported in this browser.'}
            </div>
          </div>
          <button
            type="button"
            className={`min-h-10 rounded-full px-4 text-sm font-black transition ${enabled ? 'bg-primary-600 text-white shadow-sm' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'} ${supported ? '' : 'cursor-not-allowed opacity-60'}`}
            onClick={toggleEnabled}
            disabled={!supported}
            aria-pressed={enabled}
            aria-label={enabled ? 'Turn off audio announcements' : 'Turn on audio announcements'}
          >
            {enabled ? 'On' : 'Off'}
          </button>
        </div>
      </div>
    </div>
  );
}

function OpponentStatsSection({ report }: { report: GameReportData }) {
  if (!report.opponentRows.length || !report.opponentStatKeys.length) {
    return <EmptyReportState title="No opponent stats" detail="Opponent stats will appear after they are tracked or imported." />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-gray-50 text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">
          <tr>
            <th className="px-3 py-3 text-left">#</th>
            <th className="px-3 py-3 text-left">Player</th>
            {report.opponentStatKeys.map((key) => (
              <th key={key} className="px-3 py-3 text-center">{report.opponentStatLabels[key] || key.toUpperCase()}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {report.opponentRows.map((row) => (
            <tr key={row.id}>
              <td className="px-3 py-3 font-mono font-bold text-gray-500">{row.number}</td>
              <td className="px-3 py-3 font-bold text-gray-900">{row.name}</td>
              {report.opponentStatKeys.map((key) => (
                <td key={key} className="px-3 py-3 text-center font-mono font-bold text-gray-700">{String(row.stats[key] || 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportMediaSection({ report }: { report: GameReportData }) {
  const highlightClips = report.highlightClips || [];
  const teamStatKeys = getRecordedTeamStatKeys(report);
  const hasTeamStats = teamStatKeys.length > 0;
  const hasMedia = highlightClips.length > 0 || Boolean(report.statSheetPhotoUrl) || hasTeamStats;
  if (!hasMedia) {
    return <EmptyReportState title="No report media yet" detail="Highlights, stat sheet photos, and team totals appear after the game is finalized." />;
  }

  return (
    <div className="space-y-3">
      {highlightClips.length ? (
        <div className="space-y-2">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Highlights</div>
          {highlightClips.map((clip, index) => (
            <a key={`${clip.url}-${index}`} href={clip.url} target="_blank" rel="noreferrer" className="block rounded-xl border border-gray-200 bg-white p-3 transition hover:border-primary-200 hover:bg-primary-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-gray-950">{clip.description || clip.title}</div>
                  <div className="mt-1 text-xs font-semibold text-gray-500">{[clip.period, clip.gameTime].filter(Boolean).join(' · ') || 'Replay clip'}</div>
                </div>
                <ExternalLink className="mt-0.5 h-4 w-4 flex-none text-primary-600" aria-hidden="true" />
              </div>
            </a>
          ))}
        </div>
      ) : null}

      {report.statSheetPhotoUrl ? (
        <a href={report.statSheetPhotoUrl} target="_blank" rel="noreferrer" className="block rounded-xl border border-gray-200 bg-white p-3 transition hover:border-primary-200 hover:bg-primary-50">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-gray-950">Score sheet photo</div>
              <div className="mt-0.5 text-xs font-semibold text-gray-500">Open the uploaded stat sheet from game.html.</div>
            </div>
            <ExternalLink className="h-4 w-4 flex-none text-primary-600" aria-hidden="true" />
          </div>
        </a>
      ) : null}

      {hasTeamStats ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Team stats</div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {teamStatKeys.slice(0, 8).map((key) => (
              <div key={key} className="rounded-lg bg-gray-50 p-2 text-center">
                <div className="text-[10px] font-black uppercase text-gray-500">{report.teamStatLabels[key] || key.toUpperCase()}</div>
                <div className="mt-1 text-lg font-black tabular-nums text-gray-950">{String(report.teamStats[key] || 0)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReportInsightsSection({ report }: { report: GameReportData }) {
  const hasInsights = report.teamInsights.length || report.playerInsightRows.length;
  if (!hasInsights) {
    return <EmptyReportState title="No insights yet" detail={report.emptyInsightsMessage || 'Insights populate after the game is finalized.'} />;
  }

  return (
    <div className="space-y-3">
      {report.teamInsights.length ? (
        <div className="space-y-2">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Team insights</div>
          {report.teamInsights.map((insight) => <InsightCard key={`${insight.title}-${insight.body}`} insight={insight} />)}
        </div>
      ) : null}
      {report.playerInsightRows.length ? (
        <div className="space-y-2">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Player insights</div>
          {report.playerInsightRows.map((entry) => (
            <div key={entry.playerId} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-sm font-black text-gray-950">{entry.playerName}</div>
              <div className="mt-2 space-y-2">
                {entry.insights.map((insight) => <InsightCard key={`${entry.playerId}-${insight.title}-${insight.body}`} insight={insight} compact />)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InsightCard({ insight, compact = false }: { insight: GameReportInsight; compact?: boolean }) {
  const toneClass = insight.tone === 'positive'
    ? 'border-emerald-200 bg-emerald-50'
    : insight.tone === 'warning'
      ? 'border-amber-200 bg-amber-50'
      : 'border-gray-200 bg-gray-50';
  return (
    <div className={`rounded-xl border px-3 ${compact ? 'py-2' : 'py-3'} ${toneClass}`}>
      <div className="text-sm font-black text-gray-950">{insight.title || 'Insight'}</div>
      <ReportMarkdownText text={insight.body} compact />
    </div>
  );
}

export function getRecordedTeamStatKeys(report: GameReportData) {
  return (report.teamStatKeys || []).filter((key) => hasRecordedTeamStatValue(report, key));
}

function hasRecordedTeamStatValue(report: GameReportData, key: string) {
  const teamStats = report.teamStats || {};
  if (!Object.prototype.hasOwnProperty.call(teamStats, key)) return false;
  const value = teamStats[key];
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function EmptyReportState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center">
      <div className="text-sm font-black text-gray-700">{title}</div>
      <div className="mt-1 text-xs font-semibold text-gray-500">{detail}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-black text-gray-950">{value}</div>
    </div>
  );
}

function getReportScoreLabel(game: Record<string, any>) {
  if (game.homeScore === null || game.homeScore === undefined || game.awayScore === null || game.awayScore === undefined) return '';
  return `${game.homeScore}-${game.awayScore}`;
}

function getReportResultLabel(game: Record<string, any>) {
  const homeScore = Number(game.homeScore || 0);
  const awayScore = Number(game.awayScore || 0);
  const completed = String(game.status || '').toLowerCase() === 'completed' || String(game.liveStatus || '').toLowerCase() === 'completed';
  if (homeScore > awayScore) return 'Victory';
  if (homeScore < awayScore) return 'Defeat';
  if (completed) return 'Tie';
  return 'Report';
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatReportTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
