import { useEffect, useState } from 'react';
import { Loader2, MapPin, ShieldCheck, Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Status } from '../components/TeamSummaryPrimitives';
import { formatShortDate } from '../lib/datetime';
import { getPublicTeamDetail, getPublicTeamRecentResults, type PublicTeamProfile, type PublicTeamRecentResult } from '../lib/publicTeamsService';
import type { AuthState } from '../lib/types';

export function PublicTeamDetail({ authUser }: { authUser: AuthState['user'] }) {
  const { teamId = '' } = useParams();
  const [team, setTeam] = useState<PublicTeamProfile | null>(null);
  const [recentResults, setRecentResults] = useState<PublicTeamRecentResult[] | null>(null);
  const [recentResultsError, setRecentResultsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setTeam(null);
    setRecentResults(null);
    setRecentResultsError(false);
    setError('');
    void (async () => {
      try {
        const item = await getPublicTeamDetail(teamId);
        if (!active) return;
        setTeam(item);
        setLoading(false);
        try {
          const results = await getPublicTeamRecentResults(teamId);
          if (active) setRecentResults(results);
        } catch {
          if (active) setRecentResultsError(true);
        }
      } catch (loadError: any) {
        if (active) {
          setTeam(null);
          setError(loadError?.message || 'Unable to load this public team.');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [teamId, loadAttempt]);

  if (loading) return (
    <div className="space-y-4">
      <div className="app-card p-10 text-center" role="status" aria-live="polite">
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary-600" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-900">Loading public team</div>
      </div>
      <section className="app-card p-5 sm:p-6" aria-labelledby="public-standings-heading">
        <h2 id="public-standings-heading" className="text-lg font-black text-gray-950">Standings</h2>
        <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
          Loading standings
        </div>
      </section>
    </div>
  );
  if (!team) return (
    <div className="app-card space-y-4 p-5 sm:p-6">
      <Status tone="error" message={error || 'Public team not found.'} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="primary-button w-full justify-center !min-h-11 text-sm sm:w-auto" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          Retry
        </button>
        <Link to="/teams/browse" className="secondary-button w-full justify-center !min-h-11 text-sm sm:w-auto">
          Back to team search
        </Link>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Link to="/teams/browse" className="ghost-button w-full justify-center !min-h-11 text-sm sm:w-auto">Back to team search</Link>
        <Link to="/accept-invite" className="secondary-button w-full justify-center !min-h-11 text-sm sm:w-auto">Enter a join code</Link>
        {!authUser ? <Link to="/auth" className="primary-button w-full justify-center !min-h-11 text-sm sm:w-auto">Sign in</Link> : null}
      </div>
      <section className="app-card overflow-hidden">
        <div className="bg-gradient-to-br from-primary-700 to-primary-950 p-6 text-white sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-2xl bg-white/15 ring-1 ring-white/20">
              {team.photoUrl ? <img src={team.photoUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <Users className="h-8 w-8" aria-hidden="true" />}
            </div>
            <div className="min-w-0"><div className="text-xs font-black uppercase tracking-[0.08em] text-primary-100">Public team</div><h1 className="mt-1 text-3xl font-black">{team.name}</h1><div className="mt-2 flex flex-wrap gap-3 text-sm font-bold text-primary-50">{team.sport ? <span>{team.sport}</span> : null}{team.location ? <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{team.location}</span> : null}</div></div>
          </div>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <div><div className="app-label">About</div><p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-gray-700">{team.description || 'This team has not added a public description yet.'}</p></div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-900"><div className="flex items-center gap-2 font-black"><ShieldCheck className="h-5 w-5" />Public-safe profile</div><p className="mt-1">This page shows team identity, general location, and completed public game results. Rosters, private schedules, contacts, and member data are not loaded.</p></div>
        </div>
      </section>
      <PublicStandingsSection standings={team.standings} leagueUrl={team.leagueUrl} />
      <section className="app-card p-5 sm:p-6" aria-labelledby="recent-results-heading">
        <h2 id="recent-results-heading" className="text-lg font-black text-gray-950">Recent results</h2>
        {recentResultsError ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">Recent results are temporarily unavailable.</p>
        ) : recentResults === null ? (
          <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-gray-600" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
            Loading recent results
          </div>
        ) : recentResults.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
            <div className="text-sm font-black text-gray-900">No recent results</div>
            <p className="mt-1 text-sm font-semibold text-gray-600">Completed public games will appear here.</p>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {recentResults.map((result) => {
              const resultLabel = result.result === 'win' ? 'Win' : result.result === 'loss' ? 'Loss' : 'Draw';
              const resultTone = result.result === 'win'
                ? 'bg-emerald-100 text-emerald-800'
                : result.result === 'loss'
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-gray-200 text-gray-700';
              return (
                <li key={result.id} data-testid="public-recent-result" className="flex min-w-0 flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="min-w-0 break-words text-sm font-black text-gray-950">{result.opponent}</span>
                      <span className={`rounded-full px-2 py-1 text-xs font-black uppercase tracking-wide ${resultTone}`}>{resultLabel}</span>
                    </div>
                    <div className="mt-1 text-sm font-semibold text-gray-600">{formatShortDate(result.date)}</div>
                  </div>
                  <div className="flex w-fit flex-none items-center gap-2 rounded-lg bg-gray-950 px-3 py-2 text-base font-black text-white" aria-label={`Final score: ${team.name} ${result.teamScore}, ${result.opponent} ${result.opponentScore}`}>
                    <span>{result.teamScore}</span><span aria-hidden="true">-</span><span>{result.opponentScore}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function PublicStandingsSection({ standings, leagueUrl }: { standings: PublicTeamProfile['standings']; leagueUrl: string | null }) {
  const highlightKey = getPublicStandingsRowKey(standings?.currentRow ?? null);

  return (
    <section className="app-card p-5 sm:p-6" aria-labelledby="public-standings-heading">
      <div>
        <h2 id="public-standings-heading" className="text-lg font-black text-gray-950">Standings</h2>
        <p className="mt-1 text-sm font-semibold text-gray-500">{standings?.label || 'Current league standings'}</p>
      </div>
      {!standings?.rows.length ? (
        <div className="mt-3 min-w-0 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
          <div className="text-sm font-black text-gray-900">Standings are currently unavailable</div>
          <p className="mt-1 text-sm font-semibold text-gray-600">There are no published standings for this team yet.</p>
          {leagueUrl ? <a href={leagueUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block max-w-full break-words text-sm font-black text-primary-700 underline">View league standings</a> : null}
        </div>
      ) : <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-left">
          <thead className="bg-gray-50">
            <tr className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">
              <th className="px-3 py-2.5">Rank</th>
              <th className="px-3 py-2.5">Team</th>
              <th className="px-3 py-2.5">Record</th>
              <th className="px-3 py-2.5">{getPublicStandingsContextLabel(standings.rows)}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {standings.rows.map((row, index) => {
              const isHighlighted = getPublicStandingsRowKey(row) === highlightKey;
              return (
                <tr key={`${getPublicStandingsRowKey(row)}-${index}`} className={isHighlighted ? 'bg-primary-50/70' : 'bg-white'} aria-current={isHighlighted ? 'true' : undefined}>
                  <td className={`whitespace-nowrap px-3 py-2.5 text-sm ${isHighlighted ? 'font-black text-primary-800' : 'font-semibold text-gray-700'}`}>{typeof row.rank === 'number' ? `#${row.rank}` : '—'}</td>
                  <td className={`whitespace-nowrap px-3 py-2.5 text-sm ${isHighlighted ? 'font-black text-primary-800' : 'font-semibold text-gray-900'}`}>{String(row.team || '—')}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-gray-700">{formatPublicStandingsRecord(row)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-gray-700">{formatPublicStandingsContext(row, standings.rows)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}
    </section>
  );
}

function getPublicStandingsRowKey(row: Record<string, any> | null) {
  return `${String(row?.team || '').trim() || 'team'}::${String(row?.rank || '').trim() || 'rank'}`;
}

function formatPublicStandingsRecord(row: Record<string, any>) {
  if (row.record !== undefined && row.record !== null && String(row.record).trim()) return String(row.record);
  const wins = Number.isFinite(Number(row.w)) ? Number(row.w) : null;
  const losses = Number.isFinite(Number(row.l)) ? Number(row.l) : null;
  const ties = Number.isFinite(Number(row.t)) ? Number(row.t) : null;
  if (wins === null && losses === null && ties === null) return '—';
  return `${wins ?? 0}-${losses ?? 0}${ties ? `-${ties}` : ''}`;
}

function getPublicStandingsContextLabel(rows: Array<Record<string, any>>) {
  return rows.some((row) => Number.isFinite(Number(row.points))) ? 'PTS' : 'PCT';
}

function formatPublicStandingsContext(row: Record<string, any>, rows: Array<Record<string, any>>) {
  if (getPublicStandingsContextLabel(rows) === 'PTS') return row.points ?? '—';
  if (typeof row.winPct === 'number' && Number.isFinite(row.winPct)) return row.winPct.toFixed(3);
  return row.winPct ? String(row.winPct) : '—';
}
