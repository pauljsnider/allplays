import { useEffect, useState } from 'react';
import { BarChart3, Loader2, MapPin, ShieldCheck, Users } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Status } from '../components/TeamSummaryPrimitives';
import { computeNativeStandings, type PublicTeamStandingRow } from '../lib/adapters/legacyPublicTeamsDb';
import { getPublicTeamDetail, getPublicTeamStandingsInputs, type PublicTeamProfile } from '../lib/publicTeamsService';
import type { AuthState } from '../lib/types';

type StandingsState = 'disabled' | 'loading' | 'ready' | 'empty' | 'unavailable';

export function PublicTeamDetail({ authUser }: { authUser: AuthState['user'] }) {
  const { teamId = '' } = useParams();
  const [team, setTeam] = useState<PublicTeamProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [standingsState, setStandingsState] = useState<StandingsState>('disabled');
  const [standingsRows, setStandingsRows] = useState<PublicTeamStandingRow[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setTeam(null);
    setError('');
    setStandingsState('disabled');
    setStandingsRows([]);
    getPublicTeamDetail(teamId)
      .then((item) => {
        if (!active) return;
        setTeam(item);
        if (!item.standingsConfig?.enabled) return;

        setStandingsState('loading');
        void getPublicTeamStandingsInputs(teamId)
          .then((games) => {
            if (!active) return;
            const rows = computeNativeStandings(games, item.standingsConfig);
            setStandingsRows(rows);
            setStandingsState(rows.length ? 'ready' : 'empty');
          })
          .catch(() => {
            if (!active) return;
            setStandingsRows([]);
            setStandingsState('unavailable');
          });
      })
      .catch((loadError: any) => { if (active) { setTeam(null); setError(loadError?.message || 'Unable to load this public team.'); } })
      .finally(() => { if (active) setLoading(false); });
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
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-900"><div className="flex items-center gap-2 font-black"><ShieldCheck className="h-5 w-5" />Public-safe profile</div><p className="mt-1">This page uses public team details and completed-game standings inputs only. Rosters, private schedules, contacts, and member data are not loaded.</p></div>
        </div>
      </section>
      <PublicStandingsSection team={team} state={standingsState} rows={standingsRows} />
    </div>
  );
}

function PublicStandingsSection({ team, state, rows }: {
  team: PublicTeamProfile;
  state: StandingsState;
  rows: PublicTeamStandingRow[];
}) {
  const titleId = 'public-team-standings-title';
  const isWinPercentage = team.standingsConfig?.rankingMode === 'win_pct';

  return (
    <section className="app-card min-w-0 max-w-full p-4 sm:p-5" aria-labelledby={titleId}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary-700" aria-hidden="true" />
            <h2 id={titleId} className="text-base font-black text-gray-950">Standings</h2>
          </div>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">Computed from qualifying completed public games.</p>
        </div>
        {team.leagueUrl ? <a href={team.leagueUrl} className="secondary-button w-full justify-center !min-h-9 text-xs sm:w-auto" target="_blank" rel="noreferrer">League page</a> : null}
      </div>

      {state === 'loading' ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-600" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
          Loading standings.
        </div>
      ) : state === 'ready' && rows.length ? (
        <div className="mt-4 max-w-full overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full table-fixed divide-y divide-gray-200 text-left" aria-labelledby={titleId}>
            <colgroup>
              <col className="w-[14%]" />
              <col className="w-[42%]" />
              <col className="w-[25%]" />
              <col className="w-[19%]" />
            </colgroup>
            <thead className="bg-gray-50">
              <tr className="text-[10px] font-black uppercase tracking-[0.03em] text-gray-500 sm:text-[11px]">
                <th className="px-1.5 py-2.5 text-center sm:px-3">Rank</th>
                <th className="px-1.5 py-2.5 sm:px-3">Team</th>
                <th className="px-1.5 py-2.5 text-center sm:px-3">Record</th>
                <th className="px-1.5 py-2.5 text-center sm:px-3">{isWinPercentage ? 'PCT' : 'PTS'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {rows.map((row, index) => {
                const isCurrentTeam = normalizeStandingsTeamName(row.team) === normalizeStandingsTeamName(team.name);
                return (
                  <tr
                    key={`${normalizeStandingsTeamName(row.team) || 'team'}-${formatStandingsValue(row.rank, index + 1)}-${index}`}
                    className={isCurrentTeam ? 'bg-primary-50' : 'bg-white'}
                    aria-current={isCurrentTeam ? 'true' : undefined}
                  >
                    <td className={`px-1.5 py-2.5 text-center text-xs sm:px-3 sm:text-sm ${isCurrentTeam ? 'font-black text-primary-800' : 'font-semibold text-gray-700'}`}>{formatStandingsRank(row.rank)}</td>
                    <td className={`break-words px-1.5 py-2.5 text-xs leading-4 sm:px-3 sm:text-sm ${isCurrentTeam ? 'font-black text-primary-800' : 'font-semibold text-gray-900'}`}>{formatStandingsValue(row.team)}</td>
                    <td className="whitespace-nowrap px-1 py-2.5 text-center text-xs font-semibold text-gray-700 sm:px-3 sm:text-sm">{formatStandingsRecord(row)}</td>
                    <td className="whitespace-nowrap px-1 py-2.5 text-center text-xs font-semibold text-gray-700 sm:px-3 sm:text-sm">{isWinPercentage ? formatWinPercentage(row.winPct) : formatStandingsValue(row.points)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold leading-6 text-gray-600">
          {getStandingsFallbackMessage(state)}
        </div>
      )}
    </section>
  );
}

function normalizeStandingsTeamName(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function formatStandingsValue(value: unknown, fallback: string | number = '—') {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || String(fallback);
}

function formatStandingsRank(value: unknown) {
  const rank = formatStandingsValue(value);
  return rank === '—' ? rank : `#${rank}`;
}

function formatStandingsRecord(row: PublicTeamStandingRow) {
  const record = formatStandingsValue(row.record, '');
  if (record) return record;
  const wins = formatStandingsValue(row.w, '0');
  const losses = formatStandingsValue(row.l, '0');
  const ties = Number(row.t);
  return `${wins}-${losses}${Number.isFinite(ties) && ties > 0 ? `-${ties}` : ''}`;
}

function formatWinPercentage(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : formatStandingsValue(value);
}

function getStandingsFallbackMessage(state: StandingsState) {
  if (state === 'disabled') return 'In-app standings are not enabled for this team.';
  if (state === 'unavailable') return 'Standings are temporarily unavailable.';
  return 'No completed public games are available for standings yet.';
}
