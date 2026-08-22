import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AvatarImage } from '../../components/AvatarImage';
import { PremiumGate } from '../../components/PremiumGate';
import type { PremiumAccessResult } from '../../lib/premiumAccessService';
import type { TeamDetailAnalytics, TeamDetailAnalyticsSnapshot, TeamDetailModel, TeamDetailRosterStatisticsTable } from '../../lib/teamDetailService';

const EMPTY_TEAM_ANALYTICS: TeamDetailAnalytics = {
  seasonLabel: '',
  completedGameCount: 0,
  recentWins: 0,
  recentLosses: 0,
  recentTies: 0,
  averagePointsFor: 0,
  averagePointsAgainst: 0,
  scoreDifferential: 0,
  recentForm: [],
  progression: [],
  availableSeasons: [],
  seasons: []
};

export function InsightsTab({ model, loading, error, premiumAccess }: { model: TeamDetailModel; loading: boolean; error: string; premiumAccess: PremiumAccessResult }) {
  const analyticsRoot = model.teamAnalytics || EMPTY_TEAM_ANALYTICS;
  const availableSeasons = useMemo(() => analyticsRoot.availableSeasons || [], [analyticsRoot.availableSeasons]);
  const [selectedSeason, setSelectedSeason] = useState(analyticsRoot.seasonLabel);
  useEffect(() => {
    if (availableSeasons.length && !availableSeasons.includes(selectedSeason)) setSelectedSeason(analyticsRoot.seasonLabel);
  }, [analyticsRoot.seasonLabel, availableSeasons, selectedSeason]);
  return (
    <div className="space-y-4">
      <PremiumGate access={premiumAccess} label="team performance analytics">
        <TeamPerformanceCard model={model} loading={loading} error={error} selectedSeason={selectedSeason} availableSeasons={availableSeasons} onSeasonChange={setSelectedSeason} />
      </PremiumGate>

      <PremiumGate access={premiumAccess} label="roster statistics">
        <RosterStatisticsCard model={model} loading={loading} error={error} selectedSeason={selectedSeason} />
      </PremiumGate>

      <section className="app-card p-4">
        <div className="text-sm font-black text-gray-950">Player checklist</div>
        <div className="mt-0.5 text-xs font-semibold text-gray-500">Public tracking items visible for your linked player.</div>
        <div className="mt-3 space-y-3">
          {loading ? <InlineDeferredLoading copy="Loading player tracking…" /> : null}
          {!loading && error ? <InlineDeferredError title="Player checklist unavailable" message={error} /> : null}
          {model.trackingSummaries.length ? (
            model.trackingSummaries.map((summary) => (
              <div key={summary.playerId} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center gap-3">
                  <PlayerPhoto name={summary.playerName} photoUrl={summary.photoUrl} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-gray-950">{summary.playerName}</div>
                    <div className="text-xs font-semibold text-gray-500">
                      {summary.items.filter((item) => item.isComplete).length}/{summary.items.length} complete
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  {summary.items.slice(0, 5).map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg bg-white px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-black text-gray-900">{item.title}</div>
                        {item.description ? (
                          <div className="line-clamp-1 text-[11px] font-semibold text-gray-500">{item.description}</div>
                        ) : null}
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-black ${item.isComplete ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                      >
                        {item.isComplete ? 'Done' : 'Open'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : !loading && !error ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">
              No parent-visible tracking items for your players yet.
            </div>
          ) : null}
        </div>
      </section>

      <PremiumGate access={premiumAccess} label="team leaderboards">
        <section className="app-card p-4">
          <div className="text-sm font-black text-gray-950">Leaderboards</div>
          <div className="mt-0.5 text-xs font-semibold text-gray-500">Public top stats from completed tracked games.</div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {loading ? <InlineDeferredLoading copy="Loading leaderboards…" /> : null}
            {!loading && error ? <InlineDeferredError title="Leaderboards unavailable" message={error} /> : null}
            {model.leaderboards.length ? (
              model.leaderboards.map((leaderboard) => (
                <div key={leaderboard.id} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="text-sm font-black text-gray-950">{leaderboard.label}</div>
                  <div className="mt-3 space-y-2">
                    {leaderboard.leaders.map((leader) => (
                      <div key={`${leaderboard.id}-${leader.playerId}`} className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
                        <div className="w-6 text-xs font-black text-gray-500">#{leader.rank}</div>
                        <PlayerPhoto name={leader.playerName} photoUrl={leader.photoUrl} small />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-black text-gray-950">
                            {leader.playerNumber ? `#${leader.playerNumber} ` : ''}
                            {leader.playerName}
                          </div>
                        </div>
                        <div className="text-primary-700 text-sm font-black">{leader.formattedValue}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : !loading && !error ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">
                Leaderboards appear after public stat configs and completed tracked games exist.
              </div>
            ) : null}
          </div>
        </section>
      </PremiumGate>
    </div>
  );
}

function TeamPerformanceCard({ model, loading, error, selectedSeason, availableSeasons, onSeasonChange }: { model: TeamDetailModel; loading: boolean; error: string; selectedSeason: string; availableSeasons: string[]; onSeasonChange: (season: string) => void }) {
  const analyticsRoot = model.teamAnalytics || EMPTY_TEAM_ANALYTICS;
  const seasons = useMemo(() => analyticsRoot.availableSeasons || [], [analyticsRoot.availableSeasons]);
  const analytics = (analyticsRoot.seasons || []).find((season) => season.seasonLabel === selectedSeason) || analyticsRoot;
  const scoringLabels = getTeamScoringLabels(model.team.sport);
  const maxAverage = Math.max(analytics.averagePointsFor, analytics.averagePointsAgainst, 1);
  const maxGameScore = Math.max(...analytics.progression.flatMap((game) => [game.pointsFor, game.pointsAgainst]), 1);
  const seasonPulse = getSeasonPulse(analytics, scoringLabels.unitSingular);
  const resultTone = {
    W: 'bg-emerald-100 text-emerald-800',
    L: 'bg-rose-100 text-rose-800',
    T: 'bg-gray-200 text-gray-700'
  } as const;

  return (
    <section className="app-card p-4" aria-labelledby="team-performance-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div id="team-performance-heading" className="text-sm font-black text-gray-950">
            Team performance
          </div>
          <div className="mt-0.5 text-xs font-semibold text-gray-500">Score trends from completed games.</div>
        </div>
        <div className="flex items-center gap-2">
          {availableSeasons.length > 1 ? (
            <label className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.04em] text-gray-500 uppercase">
              Season
              <select
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-black tracking-normal text-gray-800 normal-case"
                value={selectedSeason}
                onChange={(event) => onSeasonChange(event.target.value)}
              >
                {seasons.map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {analytics.completedGameCount ? (
            <div className="bg-primary-50 text-primary-700 rounded-full px-2.5 py-1 text-[10px] font-black tracking-[0.04em] uppercase">
              {analytics.completedGameCount} games
            </div>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="mt-3">
          <InlineDeferredLoading copy="Loading team performance…" />
        </div>
      ) : null}
      {!loading && error ? (
        <div className="mt-3">
          <InlineDeferredError title="Team performance unavailable" message={error} />
        </div>
      ) : null}
      {!loading && !error && !analytics.completedGameCount ? (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">
          Team performance appears after a completed game has a final score.
        </div>
      ) : null}

      {!loading && !error && analytics.completedGameCount ? (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <TeamMetric
              label={`${scoringLabels.for} / game`}
              value={formatTeamMetric(analytics.averagePointsFor)}
              tone="text-emerald-700"
            />
            <TeamMetric
              label={`${scoringLabels.against} / game`}
              value={formatTeamMetric(analytics.averagePointsAgainst)}
              tone="text-rose-700"
            />
            <TeamMetric
              label={scoringLabels.differential}
              value={`${analytics.scoreDifferential > 0 ? '+' : ''}${analytics.scoreDifferential}`}
              tone={analytics.scoreDifferential >= 0 ? 'text-emerald-700' : 'text-rose-700'}
            />
            <TeamMetric
              label="Last 5"
              value={`${analytics.recentWins}-${analytics.recentLosses}${analytics.recentTies ? `-${analytics.recentTies}` : ''}`}
              tone="text-primary-700"
            />
          </div>

          <div className="border-primary-100 from-primary-50 rounded-xl border bg-gradient-to-r via-white to-emerald-50 p-4">
            <div className="text-primary-700 text-[10px] font-black tracking-[0.06em] uppercase">Season pulse</div>
            <div className="mt-1 text-base font-black text-gray-950">{seasonPulse.headline}</div>
            <div className="mt-1 text-xs leading-5 font-semibold text-gray-600">{seasonPulse.detail}</div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black text-gray-950">Recent form</div>
                <div className="text-[10px] font-black tracking-[0.04em] text-gray-500 uppercase">Last {analytics.recentForm.length}</div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {analytics.recentForm.map((game) => (
                  <div key={game.id} className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 p-2 text-center">
                    <div
                      className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-black ${resultTone[game.result]}`}
                      aria-label={`${game.result} against ${game.opponent}, ${game.pointsFor} to ${game.pointsAgainst}`}
                    >
                      {game.result}
                    </div>
                    <div className="mt-1 text-sm font-black text-gray-950">
                      {game.pointsFor}-{game.pointsAgainst}
                    </div>
                    <div className="truncate text-[10px] font-bold text-gray-600" title={game.opponent}>
                      vs {game.opponent}
                    </div>
                    <div className="mt-0.5 text-[9px] font-bold tracking-wide text-gray-400 uppercase">{game.dateLabel}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 text-center">
                <TeamFormTotal label="Wins" value={analytics.recentWins} tone="text-emerald-700" />
                <TeamFormTotal label="Losses" value={analytics.recentLosses} tone="text-rose-700" />
                <TeamFormTotal label="Ties" value={analytics.recentTies} tone="text-gray-600" />
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-sm font-black text-gray-950">Scoring comparison</div>
              <div className="mt-4 space-y-4">
                <TeamAverageBar
                  label={scoringLabels.for}
                  value={analytics.averagePointsFor}
                  width={(analytics.averagePointsFor / maxAverage) * 100}
                  color="bg-emerald-600"
                />
                <TeamAverageBar
                  label={scoringLabels.against}
                  value={analytics.averagePointsAgainst}
                  width={(analytics.averagePointsAgainst / maxAverage) * 100}
                  color="bg-rose-600"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-black text-gray-950">Game-by-game {scoringLabels.graphNoun}</div>
              <div className="text-[10px] font-black tracking-[0.04em] text-gray-500 uppercase">Last {analytics.progression.length}</div>
            </div>
            <div className="mt-3 flex h-48 items-end gap-2 overflow-x-auto rounded-lg bg-gray-50 px-2 pt-4 pb-2">
              {analytics.progression.map((game) => (
                <div key={game.id} className="flex h-full min-w-12 flex-1 flex-col items-center justify-end gap-1">
                  <div className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${resultTone[game.result]}`}>
                    {game.result} {game.pointsFor}-{game.pointsAgainst}
                  </div>
                  <div
                    className="flex h-full w-full items-end justify-center gap-1"
                    aria-label={`${game.dateLabel} against ${game.opponent}: ${formatScoringCount(game.pointsFor, scoringLabels.unitSingular, scoringLabels.unitPlural)} for and ${formatScoringCount(game.pointsAgainst, scoringLabels.unitSingular, scoringLabels.unitPlural)} against`}
                  >
                    <div
                      className="bg-primary-600 w-2/5 rounded-t"
                      style={{ height: `${Math.max(7, (game.pointsFor / maxGameScore) * 100)}%` }}
                    />
                    <div
                      className="w-2/5 rounded-t bg-gray-300"
                      style={{ height: `${Math.max(7, (game.pointsAgainst / maxGameScore) * 100)}%` }}
                    />
                  </div>
                  <div className="w-full truncate text-center text-[9px] font-bold text-gray-500">{game.dateLabel}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-center gap-4 text-[10px] font-bold text-gray-500">
              <span className="inline-flex items-center gap-1">
                <span className="bg-primary-600 h-2 w-2 rounded-sm" />
                {scoringLabels.for}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-gray-300" />
                {scoringLabels.against}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RosterStatisticsCard({ model, loading, error, selectedSeason }: { model: TeamDetailModel; loading: boolean; error: string; selectedSeason: string }) {
  const root = model.rosterStatistics;
  const table: TeamDetailRosterStatisticsTable | undefined = root?.seasons?.find((season) => season.seasonLabel === selectedSeason) || root?.seasons?.[0];
  const seasonUnavailable = root?.unavailableSeasons?.includes(selectedSeason) === true;
  return <section className="app-card p-4" aria-labelledby="roster-statistics-heading">
    <div id="roster-statistics-heading" className="text-sm font-black text-gray-950">Roster statistics</div>
    <div className="mt-0.5 text-xs font-semibold text-gray-500">Season totals from completed tracked games.</div>
    <div className="mt-3">
      {loading ? <InlineDeferredLoading copy="Loading roster statistics…" /> : null}
      {!loading && error ? <InlineDeferredError title="Roster statistics unavailable" message={error} /> : null}
      {!loading && !error && seasonUnavailable ? <InlineDeferredError title="Roster statistics unavailable" message={`Statistics for the ${selectedSeason} season could not be loaded.`} /> : null}
      {!loading && !error && !seasonUnavailable && table?.columns.length ? <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-max w-full text-left text-xs"><thead className="bg-gray-50 text-[10px] font-black uppercase tracking-wide text-gray-500"><tr><th className="sticky left-0 bg-gray-50 px-3 py-2">Player</th>{table.columns.map((column) => <th key={column.id} className="whitespace-nowrap px-3 py-2">{column.label}</th>)}</tr></thead><tbody>{table.rows.map((row) => <tr key={row.playerId} className="border-t border-gray-100"><th className="sticky left-0 bg-white px-3 py-2 font-black text-gray-900">{row.playerNumber ? `#${row.playerNumber} ` : ''}{row.playerName}</th>{table.columns.map((column) => <td key={column.id} className="px-3 py-2 font-bold text-gray-700">{row.values[column.id]?.formattedValue || '0'}</td>)}</tr>)}</tbody></table>
      </div> : null}
      {!loading && !error && !seasonUnavailable && !table?.columns.length ? <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">Roster statistics appear after public player stats are configured.</div> : null}
    </div>
  </section>;
}

function TeamMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className={`text-xl font-black ${tone}`}>{value}</div>
      <div className="mt-1 text-[10px] font-black tracking-[0.04em] text-gray-500 uppercase">{label}</div>
    </div>
  );
}

function TeamFormTotal({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className={`text-lg font-black ${tone}`}>{value}</div>
      <div className="text-[10px] font-bold text-gray-500">{label}</div>
    </div>
  );
}

function TeamAverageBar({ label, value, width, color }: { label: string; value: number; width: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-[10px] font-black tracking-[0.04em] text-gray-500 uppercase">{label}</div>
        <div className="text-xs font-black text-gray-950">{formatTeamMetric(value)}</div>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.max(6, width)}%` }}
          aria-label={`${label} average ${formatTeamMetric(value)}`}
        />
      </div>
    </div>
  );
}

function formatTeamMetric(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatScoringCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function getTeamScoringLabels(sport: string) {
  const normalizedSport = String(sport || '')
    .trim()
    .toLowerCase();
  if (['soccer', 'hockey', 'lacrosse', 'field hockey', 'water polo'].includes(normalizedSport)) {
    return {
      for: 'Goals for',
      against: 'Goals against',
      differential: 'Goal difference',
      graphNoun: 'goals',
      unitSingular: 'goal',
      unitPlural: 'goals'
    };
  }
  if (['baseball', 'softball', 'cricket'].includes(normalizedSport)) {
    return {
      for: 'Runs for',
      against: 'Runs against',
      differential: 'Run difference',
      graphNoun: 'runs',
      unitSingular: 'run',
      unitPlural: 'runs'
    };
  }
  return {
    for: 'Points for',
    against: 'Points against',
    differential: 'Point difference',
    graphNoun: 'scoring',
    unitSingular: 'point',
    unitPlural: 'points'
  };
}

function getSeasonPulse(analytics: TeamDetailAnalyticsSnapshot, unitSingular: string) {
  const averageGap = Math.round(Math.abs(analytics.averagePointsFor - analytics.averagePointsAgainst) * 10) / 10;
  const bestResult = [...analytics.progression].sort((a, b) => b.differential - a.differential)[0];
  const recentSummary = `${analytics.recentWins} win${analytics.recentWins === 1 ? '' : 's'}, ${analytics.recentLosses} loss${analytics.recentLosses === 1 ? '' : 'es'}${analytics.recentTies ? `, and ${analytics.recentTies} tie${analytics.recentTies === 1 ? '' : 's'}` : ''} in the last ${analytics.recentForm.length}.`;
  if (analytics.averagePointsFor > analytics.averagePointsAgainst) {
    return {
      headline: `Positive margin: +${formatTeamMetric(averageGap)} ${unitSingular}${averageGap === 1 ? '' : 's'} per game`,
      detail: `${recentSummary}${bestResult ? ` Best result in this view: ${bestResult.pointsFor}-${bestResult.pointsAgainst} vs ${bestResult.opponent}.` : ''}`
    };
  }
  if (analytics.averagePointsFor < analytics.averagePointsAgainst) {
    return {
      headline: `The clearest opportunity is closing a ${formatTeamMetric(averageGap)}-${unitSingular}-per-game gap`,
      detail: `${recentSummary}${bestResult && bestResult.differential > 0 ? ` Best result in this view: ${bestResult.pointsFor}-${bestResult.pointsAgainst} vs ${bestResult.opponent}.` : ''}`
    };
  }
  return { headline: 'Scoring is level across the season', detail: recentSummary };
}

function InlineDeferredLoading({ copy }: { copy: string }) {
  return (
    <div className="border-primary-200 bg-primary-50 rounded-xl border p-4">
      <div className="flex items-center gap-3 text-sm font-semibold text-gray-600">
        <Loader2 className="text-primary-600 h-4 w-4 animate-spin" aria-hidden="true" />
        {copy}
      </div>
    </div>
  );
}

function InlineDeferredError({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
      <div className="text-sm font-black text-gray-950">{title}</div>
      <div className="mt-1 text-xs font-semibold text-rose-700">{message}</div>
    </div>
  );
}

function PlayerPhoto({ name, photoUrl, small = false }: { name: string; photoUrl?: string | null; small?: boolean }) {
  const sizeClass = small ? 'h-8 w-8 text-[10px]' : 'h-11 w-11 text-xs';
  if (photoUrl) {
    return (
      <AvatarImage
        src={photoUrl}
        alt={`${name} player photo`}
        loading="lazy"
        className={`${sizeClass} flex-none rounded-full object-cover ring-1 ring-gray-200`}
        fallback={
          <span className={`${sizeClass} flex flex-none items-center justify-center rounded-full bg-gray-900 font-black text-white`}>
            {getInitials(name)}
          </span>
        }
      />
    );
  }
  return (
    <span className={`${sizeClass} flex flex-none items-center justify-center rounded-full bg-gray-900 font-black text-white`}>
      {getInitials(name)}
    </span>
  );
}

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'AP'
  );
}
