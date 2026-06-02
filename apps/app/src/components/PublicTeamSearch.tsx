import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, XCircle, Loader2, Users } from 'lucide-react';
import { type ParentHomeTeam } from '../lib/homeLogic';
import { TeamAvatar, TeamLauncherChip, Status } from '../pages/Teams';
import { openPublicUrl } from '../lib/publicActions';
import { getPublicTeamsByLocation } from '../lib/publicTeamsService';
import { resolveZip } from '../lib/utils';

const PUBLIC_TEAM_WEBSITE_BASE_URL = 'https://allplays.ai/team.html';

export function PublicTeamSearch() {
  const navigate = useNavigate();
  const [locationQuery, setLocationQuery] = useState<string>('');
  const [publicTeams, setPublicTeams] = useState<ParentHomeTeam[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [activeSearchLocation, setActiveSearchLocation] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState<boolean>(false);

  const fetchPublicTeams = useCallback(async (location?: string) => {
    setLoading(true);
    setError('');
    setHasSearched(true);
    try {
      const teams = await getPublicTeamsByLocation(location);
      setPublicTeams(teams);
      setActiveSearchLocation(location || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch public teams.');
      setPublicTeams([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => {
    void fetchPublicTeams(locationQuery.trim() || undefined);
  };

  const handleBrowseAll = () => {
    void fetchPublicTeams();
  };

  const handleClear = () => {
    setLocationQuery('');
    setPublicTeams([]);
    setError('');
    setActiveSearchLocation(null);
    setHasSearched(false);
  };

  const handleOpenTeam = useCallback(async (team: ParentHomeTeam) => {
    if (team.appAccess) {
      navigate(`/teams/${encodeURIComponent(team.teamId)}`);
      return;
    }

    if (team.webAccess) {
      await openPublicUrl(`${PUBLIC_TEAM_WEBSITE_BASE_URL}#teamId=${encodeURIComponent(team.teamId)}`);
    }
  }, [navigate]);

  const groupedTeams = useMemo(() => {
    const groups: Record<string, ParentHomeTeam[]> = {};
    publicTeams.forEach(team => {
      // Use resolveZip for grouping, fall back to 'Unknown Location'
      const resolvedLocation = team.location ? resolveZip(team.location) : 'Unknown Location';
      if (!groups[resolvedLocation]) {
        groups[resolvedLocation] = [];
      }
      groups[resolvedLocation].push(team);
    });
    return groups;
  }, [publicTeams]);

  return (
    <section className="app-card p-3 sm:p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-black text-gray-950 sm:text-2xl">Discover Public Teams</h2>
      </div>

      <div className="flex gap-2">
        <label className="sr-only" htmlFor="public-team-location-search">Search by city, state, or zip</label>
        <input
          id="public-team-location-search"
          type="text"
          className="auth-input flex-1 !min-h-10 !px-3 !py-2 text-sm"
          placeholder="Search by city, state, or zip"
          value={locationQuery}
          onChange={(e) => setLocationQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSearch();
            }
          }}
        />
        <button
          type="button"
          className="primary-button !min-h-10 !px-3 text-sm"
          onClick={handleSearch}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">Search</span>
        </button>
        {locationQuery || activeSearchLocation ? (
          <button
            type="button"
            className="ghost-button !min-h-10 !px-3 text-sm"
            onClick={handleClear}
            disabled={loading}
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        ) : null}
      </div>

      {!hasSearched && !loading ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <Users className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
          <div className="mt-3 text-sm font-black text-gray-900">Search for public teams near you</div>
          <div className="mt-1 text-xs font-semibold text-gray-500">Enter a city, state, or zip code to find nearby teams.</div>
          <button
            type="button"
            className="ghost-button mt-4 !min-h-10 !px-3 text-sm"
            onClick={handleBrowseAll}
            disabled={loading}
          >
            Browse all public teams
          </button>
        </div>
      ) : loading && !publicTeams.length ? (
        <div className="app-card p-6 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
          <div className="mt-3 text-sm font-black text-gray-900">Loading public teams</div>
          <div className="mt-1 text-xs font-semibold text-gray-500">{activeSearchLocation ? `Searching for teams near "${activeSearchLocation}".` : 'Browsing teams across all regions.'}</div>
        </div>
      ) : error ? (
        <Status tone="error" message={error} />
      ) : Object.keys(groupedTeams).length ? (
        <div className="space-y-4">
          {Object.entries(groupedTeams).map(([location, teams]) => (
            <div key={location} className="space-y-2">
              <h3 className="text-lg font-black text-gray-950">{location}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {teams.map(team => (
                  <PublicTeamCard key={team.teamId} team={team} onOpenTeam={handleOpenTeam} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500 text-center">
          No public teams found {activeSearchLocation ? `for "${activeSearchLocation}"` : ''}. Try a different location or browse all public teams.
        </div>
      )}
    </section>
  );
}

function PublicTeamCard({ team, onOpenTeam }: { team: ParentHomeTeam; onOpenTeam: (team: ParentHomeTeam) => void | Promise<void> }) {
  const isActionable = Boolean(team.appAccess || team.webAccess);
  const actionLabel = team.appAccess ? 'View team' : 'View team on website';

  return (
    <article className={`min-w-0 rounded-2xl border bg-white p-3 shadow-sm ${isActionable ? 'border-gray-200' : 'border-gray-200/80 bg-gray-50'}`}>
      <div className="flex min-w-0 items-center gap-3">
        <TeamAvatar name={team.teamName} photoUrl={team.photoUrl} />
        <span className="min-w-0 flex-1">
          <span className="truncate text-sm font-black text-gray-950">{team.teamName}</span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-gray-500">{team.location || 'Location Unknown'}</span>
          <span className="mt-1 flex min-w-0 flex-wrap gap-1.5">
            <TeamLauncherChip label={`${team.players.length} player${team.players.length === 1 ? '' : 's'}`} />
          </span>
        </span>
      </div>

      {isActionable ? (
        <button
          type="button"
          className="primary-button mt-3 w-full justify-center !min-h-10 text-sm"
          onClick={() => {
            void onOpenTeam(team);
          }}
        >
          {actionLabel}
        </button>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-gray-300 bg-white/70 px-3 py-2 text-xs font-semibold text-gray-500">
          Team page is not available in the app yet.
        </div>
      )}
    </article>
  );
}

// Remove duplicated Status component as it's now imported from './Teams'
