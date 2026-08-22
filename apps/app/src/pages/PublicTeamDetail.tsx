import { useEffect, useState } from 'react';
import { Loader2, MapPin, ShieldCheck, Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Status } from '../components/TeamSummaryPrimitives';
import { formatShortDate } from '../lib/datetime';
import { getPublicTeamDetail, getPublicTeamRecentResults, getPublicTeamStandingsInputs, type PublicTeamProfile, type PublicTeamRecentResult } from '../lib/publicTeamsService';
import { computeNativeStandings } from '../lib/adapters/legacyTeamDetail';
import type { AuthState } from '../lib/types';

export function PublicTeamDetail({ authUser }: { authUser: AuthState['user'] }) {
  const { teamId = '' } = useParams();
  const [team, setTeam] = useState<PublicTeamProfile | null>(null);
  const [recentResults, setRecentResults] = useState<PublicTeamRecentResult[] | null>(null);
  const [recentResultsError, setRecentResultsError] = useState(false);
  const [standings, setStandings] = useState<PublicStandingsViewModel | null>(null);
  const [standingsError, setStandingsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setTeam(null);
    setRecentResults(null);
    setRecentResultsError(false);
    setStandings(null);
    setStandingsError(false);
    setError('');
    void (async () => {
      try {
        const item = await getPublicTeamDetail(teamId);
        if (!active) return;
        setTeam(item);
        setLoading(false);
        void getPublicTeamStandingsInputs(teamId)
          .then((inputs) => {
            if (active) setStandings(buildPublicStandingsViewModel(item, inputs));
          })
          .catch(() => {
            if (active) setStandingsError(true);
          });
        void getPublicTeamRecentResults(teamId)
          .then((results) => {
            if (active) setRecentResults(results);
          })
          .catch(() => {
            if (active) setRecentResultsError(true);
          });
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
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-900"><div className="flex items-center gap-2 font-black"><ShieldCheck className="h-5 w-5" />Public-safe profile</div><p className="mt-1">This page shows team identity, general location, and completed public game results. Rosters, private schedules, contacts, and member data are not loaded.</p></div>
        </div>
      </section>
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
      <PublicStandingsSection team={team} standings={standings} error={standingsError} />
    </div>
  );
}

type PublicStandingsRow = Record<string, any>;
type PublicStandingsViewModel = {
  rows: PublicStandingsRow[];
  currentRow: PublicStandingsRow | null;
  contextLabel: string;
};

function buildPublicStandingsViewModel(team: PublicTeamProfile, inputs: Parameters<typeof computeNativeStandings>[0]): PublicStandingsViewModel {
  const config = team.standingsConfig;
  const rows = config?.enabled ? computeNativeStandings(inputs, config) : [];
  return {
    rows,
    currentRow: rows.find((row: PublicStandingsRow) => row.team === team.name) || null,
    contextLabel: config?.rankingMode === 'win_pct' ? 'PCT' : 'PTS'
  };
}

function PublicStandingsSection({ team, standings, error }: { team: PublicTeamProfile; standings: PublicStandingsViewModel | null; error: boolean }) {
  const hasRows = Boolean(standings?.rows.length);
  if (error) {
    return <section className="app-card p-5 sm:p-6" aria-labelledby="standings-heading"><h2 id="standings-heading" className="text-lg font-black text-gray-950">Standings</h2><p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">Standings are temporarily unavailable.</p></section>;
  }
  return (
    <section className="app-card p-5 sm:p-6" aria-labelledby="standings-heading">
      <div className="flex items-start justify-between gap-3">
        <div><h2 id="standings-heading" className="text-lg font-black text-gray-950">Standings</h2><p className="mt-1 text-sm font-semibold text-gray-600">{hasRows ? 'Current league standings with this team highlighted.' : 'Standings are unavailable for this team.'}</p></div>
        {!hasRows && team.leagueUrl ? <a href={team.leagueUrl} className="secondary-button !min-h-9 shrink-0 text-xs" target="_blank" rel="noreferrer">League page</a> : null}
      </div>
      {standings === null ? <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-gray-600" role="status"><Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />Loading standings</div> : hasRows ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full table-fixed divide-y divide-gray-200 text-left" data-testid="public-standings-table">
            <colgroup><col className="w-[15%]" /><col className="w-[43%]" /><col className="w-[24%]" /><col className="w-[18%]" /></colgroup>
            <thead className="bg-gray-50"><tr className="text-[10px] font-black uppercase tracking-wide text-gray-500"><th className="px-2 py-2 sm:px-3">Rank</th><th className="px-2 py-2 sm:px-3">Team</th><th className="px-2 py-2 sm:px-3">Record</th><th className="px-2 py-2 sm:px-3">{standings.contextLabel}</th></tr></thead>
            <tbody className="divide-y divide-gray-100 bg-white">{standings.rows.map((row) => { const highlighted = row === standings.currentRow; return <tr key={`${row.team}-${row.rank}`} className={highlighted ? 'bg-primary-50/70' : 'bg-white'} aria-current={highlighted ? 'true' : undefined}><td className="whitespace-nowrap px-2 py-2 text-xs font-semibold text-gray-700 sm:px-3">{typeof row.rank === 'number' ? `#${row.rank}` : '—'}</td><td className={`break-words px-2 py-2 text-xs sm:px-3 ${highlighted ? 'font-black text-primary-800' : 'font-semibold text-gray-900'}`}>{row.team || '—'}</td><td className="whitespace-nowrap px-2 py-2 text-xs font-semibold text-gray-700 sm:px-3">{row.record || '—'}</td><td className="whitespace-nowrap px-2 py-2 text-xs font-semibold text-gray-700 sm:px-3">{standings.contextLabel === 'PCT' ? (typeof row.winPct === 'number' ? row.winPct.toFixed(3) : '—') : (row.points ?? '—')}</td></tr>; })}</tbody>
          </table>
        </div>
      ) : <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-600">No standings rows are available yet.</div>}
    </section>
  );
}
