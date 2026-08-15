import { useEffect, useState } from 'react';
import { Loader2, MapPin, ShieldCheck, Trophy, Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Status } from '../components/TeamSummaryPrimitives';
import { getPublicTeamDetail, getPublicTeamResults, type PublicTeamProfile, type PublicTeamResults } from '../lib/publicTeamsService';
import type { AuthState } from '../lib/types';

export function PublicTeamDetail({ authUser }: { authUser: AuthState['user'] }) {
  const { teamId = '' } = useParams();
  const [team, setTeam] = useState<PublicTeamProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [results, setResults] = useState<PublicTeamResults | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState('');
  const [resultsLoadAttempt, setResultsLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setTeam(null);
    setError('');
    getPublicTeamDetail(teamId)
      .then((item) => { if (active) setTeam(item); })
      .catch((loadError: unknown) => { if (active) { setTeam(null); setError(errorMessage(loadError, 'Unable to load this public team.')); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [teamId, loadAttempt]);

  useEffect(() => {
    if (!team) {
      setResults(null);
      setResultsLoading(false);
      setResultsError('');
      return;
    }
    let active = true;
    setResults(null);
    setResultsLoading(true);
    setResultsError('');
    getPublicTeamResults(team)
      .then((loadedResults) => { if (active) setResults(loadedResults); })
      .catch((loadError: unknown) => { if (active) setResultsError(errorMessage(loadError, 'Unable to load public results.')); })
      .finally(() => { if (active) setResultsLoading(false); });
    return () => { active = false; };
  }, [team, resultsLoadAttempt]);

  if (loading) return (
    <div className="app-card p-10 text-center" role="status" aria-live="polite">
      <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary-600" aria-hidden="true" />
      <div className="mt-3 text-sm font-black text-gray-900">Loading public team</div>
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
              {team.photoUrl ? <img src={team.photoUrl} alt="" className="h-full w-full object-cover" /> : <Users className="h-8 w-8" aria-hidden="true" />}
            </div>
            <div className="min-w-0"><div className="text-xs font-black uppercase tracking-[0.08em] text-primary-100">Public team</div><h1 className="mt-1 text-3xl font-black">{team.name}</h1><div className="mt-2 flex flex-wrap gap-3 text-sm font-bold text-primary-50">{team.sport ? <span>{team.sport}</span> : null}{team.location ? <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{team.location}</span> : null}</div></div>
          </div>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <div><div className="app-label">About</div><p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-gray-700">{team.description || 'This team has not added a public description yet.'}</p></div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-900"><div className="flex items-center gap-2 font-black"><ShieldCheck className="h-5 w-5" />Public-safe profile</div><p className="mt-1">Public final scores and standings are loaded from the team&apos;s sanitized public feed. Rosters, private schedules, contacts, assignments, and member data are not loaded.</p></div>
        </div>
      </section>
      <PublicResultsSection
        team={team}
        results={results}
        loading={resultsLoading}
        error={resultsError}
        onRetry={() => setResultsLoadAttempt((attempt) => attempt + 1)}
      />
    </div>
  );
}

function PublicResultsSection({
  team,
  results,
  loading,
  error,
  onRetry
}: {
  team: PublicTeamProfile;
  results: PublicTeamResults | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const rows = results?.standings.rows || [];
  const contextIsWinPct = results?.standings.label === 'Win percentage';

  return (
    <section className="app-card p-4 sm:p-5" aria-labelledby="public-standings-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-gray-950">
            <Trophy className="h-5 w-5 text-primary-700" aria-hidden="true" />
            <h2 id="public-standings-heading" className="text-lg font-black">Standings</h2>
          </div>
          <p className="mt-1 text-xs font-semibold text-gray-500">Computed from completed games in the sanitized public feed.</p>
        </div>
        {team.leagueUrl ? <a href={team.leagueUrl} className="secondary-button w-full justify-center !min-h-10 text-xs sm:w-auto" target="_blank" rel="noreferrer">League standings</a> : null}
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-600" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
          Loading public results
        </div>
      ) : error ? (
        <div className="mt-4 space-y-3">
          <Status tone="error" message={error} />
          <button type="button" className="secondary-button w-full justify-center !min-h-10 text-sm sm:w-auto" onClick={onRetry}>Retry results</button>
        </div>
      ) : (
        <>
          {rows.length ? (
            <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-left">
                <thead className="bg-gray-50">
                  <tr className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">
                    <th className="whitespace-nowrap px-3 py-2.5">Rank</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Team</th>
                    <th className="whitespace-nowrap px-3 py-2.5">Record</th>
                    <th className="whitespace-nowrap px-3 py-2.5">{contextIsWinPct ? 'PCT' : 'PTS'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {rows.map((row) => {
                    const isCurrent = results?.standings.currentRow?.teamId === row.teamId;
                    return (
                      <tr key={`${row.teamId}:${String(row?.rank || '')}`} className={isCurrent ? 'bg-primary-50/70' : 'bg-white'} aria-current={isCurrent ? 'true' : undefined}>
                        <td className={`whitespace-nowrap px-3 py-2.5 text-sm ${isCurrent ? 'font-black text-primary-800' : 'font-semibold text-gray-700'}`}>{typeof row?.rank === 'number' ? `#${row.rank}` : '—'}</td>
                        <td className={`whitespace-nowrap px-3 py-2.5 text-sm ${isCurrent ? 'font-black text-primary-800' : 'font-semibold text-gray-900'}`}>{String(row?.team || '—')}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-gray-700">{standingsRecord(row)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-gray-700">{contextIsWinPct ? standingsWinPct(row) : standingsPoints(row)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-600">No completed public games are available for standings yet.</div>
          )}

          <div className="mt-5 border-t border-gray-100 pt-4">
            <h3 className="text-sm font-black text-gray-950">Recent results</h3>
            {results?.recentResults.length ? (
              <ul className="mt-3 space-y-2">
                {results.recentResults.map((game) => (
                  <li key={`${game.id}:${game.date.getTime()}`} className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-gray-950">vs. {game.opponent}</div>
                      <div className="mt-1 text-xs font-semibold text-gray-500">{game.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <span className="whitespace-nowrap text-base font-black text-gray-950">{game.teamScore} - {game.opponentScore}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${resultTone(game.result)}`}>{game.result}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-600">No recent final scores are available yet.</div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function standingsRecord(row: Record<string, unknown>): string {
  if (String(row?.record || '').trim()) return String(row.record).trim();
  const wins = Number.isFinite(row?.w) ? row.w : 0;
  const losses = Number.isFinite(row?.l) ? row.l : 0;
  const ties = Number.isFinite(row?.t) ? row.t : 0;
  return `${wins}-${losses}${ties ? `-${ties}` : ''}`;
}

function standingsWinPct(row: Record<string, unknown>): string {
  return typeof row?.winPct === 'number' && Number.isFinite(row.winPct) ? row.winPct.toFixed(3) : '—';
}

function standingsPoints(row: Record<string, unknown>): string {
  return typeof row?.points === 'number' && Number.isFinite(row.points) ? String(row.points) : '—';
}

function resultTone(result: 'Win' | 'Loss' | 'Tie'): string {
  if (result === 'Win') return 'bg-emerald-100 text-emerald-800';
  if (result === 'Loss') return 'bg-rose-100 text-rose-800';
  return 'bg-amber-100 text-amber-800';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
