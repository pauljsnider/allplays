import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ChevronLeft, ExternalLink, Heart, Loader2, Search, Shield } from 'lucide-react';
import { DRILL_LEVELS, DRILL_TYPES, DRILL_TYPE_COLORS } from '../../../../js/drill-constants.js';
import { openPublicUrl } from '../lib/publicActions';
import { filterDrillSummaries, loadFavoriteDrills, loadTeamDrillLibraryPage, setTeamDrillFavorite, type TeamDrillSummary } from '../lib/teamDrillsService';
import type { AuthState } from '../lib/types';

type DrillTab = 'community' | 'favorites';

const drillTypeOptions = DRILL_TYPES as string[];
const drillLevelOptions = DRILL_LEVELS as string[];

export function TeamDrills({ auth }: { auth: AuthState }) {
  const { teamId = '' } = useParams();
  const [teamName, setTeamName] = useState('Team');
  const [teamSport, setTeamSport] = useState('Soccer');
  const [canManageDrills, setCanManageDrills] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [communityDrills, setCommunityDrills] = useState<TeamDrillSummary[]>([]);
  const [favoriteDrills, setFavoriteDrills] = useState<TeamDrillSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<unknown | null>(null);
  const [selectedTab, setSelectedTab] = useState<DrillTab>('community');
  const [searchDraft, setSearchDraft] = useState('');
  const [searchText, setSearchText] = useState('');
  const [typeDraft, setTypeDraft] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [levelDraft, setLevelDraft] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [error, setError] = useState('');
  const [selectedDrill, setSelectedDrill] = useState<TeamDrillSummary | null>(null);
  const [favoriteBusyId, setFavoriteBusyId] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadInitialPage() {
      if (!teamId) return;
      setLoading(true);
      setError('');
      try {
        const page = await loadTeamDrillLibraryPage(teamId, auth.user, {
          searchText,
          type: typeFilter,
          level: levelFilter
        });
        if (cancelled) return;
        setTeamName(page.team.name);
        setTeamSport(page.team.sport);
        setCanManageDrills(page.canManageDrills);
        setCommunityDrills(page.drills);
        setFavoriteIds(page.favoriteIds);
        setNextCursor(page.nextCursor);
        setFavoriteDrills(null);
      } catch (loadError: any) {
        if (cancelled) return;
        setError(loadError?.message || 'Unable to load the community drill library.');
        setCommunityDrills([]);
        setFavoriteIds([]);
        setNextCursor(null);
        setFavoriteDrills(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitialPage();
    return () => {
      cancelled = true;
    };
  }, [auth.user, levelFilter, searchText, teamId, typeFilter]);

  useEffect(() => {
    let cancelled = false;

    async function loadFavoritesForTab() {
      if (!teamId || selectedTab !== 'favorites' || favoriteDrills !== null || !canManageDrills) return;
      setFavoritesLoading(true);
      setError('');
      try {
        const model = await loadFavoriteDrills(teamId, auth.user);
        if (cancelled) return;
        setFavoriteIds(model.favoriteIds);
        setFavoriteDrills(model.drills);
      } catch (loadError: any) {
        if (cancelled) return;
        setError(loadError?.message || 'Unable to load favorite drills.');
      } finally {
        if (!cancelled) setFavoritesLoading(false);
      }
    }

    void loadFavoritesForTab();
    return () => {
      cancelled = true;
    };
  }, [auth.user, canManageDrills, favoriteDrills, selectedTab, teamId]);

  const visibleFavoriteDrills = useMemo(() => filterDrillSummaries(favoriteDrills || [], {
    searchText,
    type: typeFilter,
    level: levelFilter
  }), [favoriteDrills, levelFilter, searchText, typeFilter]);

  if (!teamId) return <Navigate to="/teams" replace />;

  async function loadMore() {
    if (!teamId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const page = await loadTeamDrillLibraryPage(teamId, auth.user, {
        searchText,
        type: typeFilter,
        level: levelFilter,
        cursor: nextCursor
      });
      setCommunityDrills((current) => [...current, ...page.drills]);
      setFavoriteIds(page.favoriteIds);
      setNextCursor(page.nextCursor);
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load more drills.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleFavorite(drill: TeamDrillSummary) {
    if (!teamId || favoriteBusyId) return;
    const isFavorite = favoriteIds.includes(drill.id);
    const nextFavoriteIds = isFavorite
      ? favoriteIds.filter((id) => id !== drill.id)
      : [...favoriteIds, drill.id];

    setFavoriteBusyId(drill.id);
    setFavoriteIds(nextFavoriteIds);
    if (selectedDrill?.id === drill.id) {
      setSelectedDrill(drill);
    }
    if (favoriteDrills) {
      setFavoriteDrills((current) => {
        const safeCurrent = current || [];
        if (isFavorite) return safeCurrent.filter((entry) => entry.id !== drill.id);
        return [...safeCurrent, drill].sort((left, right) => left.title.localeCompare(right.title));
      });
    }

    try {
      await setTeamDrillFavorite(teamId, auth.user, drill.id, !isFavorite);
    } catch (toggleError: any) {
      setFavoriteIds(favoriteIds);
      if (favoriteDrills) {
        setFavoriteDrills(favoriteDrills);
      }
      setError(toggleError?.message || 'Unable to update drill favorite.');
    } finally {
      setFavoriteBusyId('');
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchText(searchDraft.trim());
    setTypeFilter(typeDraft);
    setLevelFilter(levelDraft);
  }

  const activeDrills = selectedTab === 'community' ? communityDrills : visibleFavoriteDrills;
  const heading = `${teamName} drills`;

  if (loading) {
    return (
      <section className="app-card p-5 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-950">Loading drill library</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Fetching community drills without pulling the whole library at once.</div>
      </section>
    );
  }

  if (error && !communityDrills.length && selectedTab === 'community') {
    return <StatusCard title="Drill library unavailable" message={error} backTo={`/teams/${encodeURIComponent(teamId)}`} />;
  }

  if (!canManageDrills) {
    return <StatusCard title="Coach/admin access required" message="Only team owners, team admins, and global admins can browse and favorite drills for a team." backTo={`/teams/${encodeURIComponent(teamId)}`} />;
  }

  return (
    <div className="space-y-4">
      <section className="app-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link to={`/teams/${encodeURIComponent(teamId)}`} className="ghost-button !min-h-8 px-0 text-xs text-primary-700">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Back to team
            </Link>
            <h1 className="mt-2 text-2xl font-black text-gray-950">{heading}</h1>
            <p className="mt-1 text-sm font-semibold text-gray-600">Browse the shared {teamSport} drill library, filter it fast, and keep team favorites synced with the website.</p>
          </div>
          <div className="rounded-xl border border-primary-100 bg-primary-50 px-3 py-2 text-xs font-black text-primary-800">
            Team-scoped favorites sync with drills.html automatically.
          </div>
        </div>
        <form className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto]" onSubmit={submitSearch}>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Search by name or skill</span>
            <div className="mt-1 flex items-center rounded-xl border border-gray-200 bg-white px-3">
              <Search className="h-4 w-4 text-gray-400" aria-hidden="true" />
              <input
                aria-label="Search drills"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Rondo, finishing, dribbling..."
                className="min-h-10 w-full border-0 bg-transparent px-2 text-sm font-semibold text-gray-950 outline-none"
              />
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Category</span>
            <select aria-label="Category" value={typeDraft} onChange={(event) => setTypeDraft(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100">
              <option value="">All categories</option>
              {drillTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Skill level</span>
            <select aria-label="Skill level" value={levelDraft} onChange={(event) => setLevelDraft(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100">
              <option value="">All skill levels</option>
              {drillLevelOptions.map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
          </label>
          <button type="submit" className="primary-button self-end !min-h-10 text-xs">Apply</button>
        </form>
        <div className="mt-4 flex gap-2">
          <button type="button" className={`secondary-button !min-h-9 text-xs ${selectedTab === 'community' ? '!border-primary-600 !bg-primary-600 !text-white' : ''}`} onClick={() => setSelectedTab('community')}>
            Community
          </button>
          <button type="button" className={`secondary-button !min-h-9 text-xs ${selectedTab === 'favorites' ? '!border-primary-600 !bg-primary-600 !text-white' : ''}`} onClick={() => setSelectedTab('favorites')}>
            Favorites ({favoriteIds.length})
          </button>
        </div>
        {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-black text-rose-700">{error}</div> : null}
      </section>

      <section className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {favoritesLoading && selectedTab === 'favorites' ? (
          <section className="app-card p-5 text-sm font-semibold text-gray-500 lg:col-span-2 xl:col-span-3">Loading favorite drills…</section>
        ) : null}
        {!favoritesLoading && activeDrills.length ? activeDrills.map((drill) => (
          <DrillCard
            key={drill.id}
            drill={drill}
            isFavorite={favoriteIds.includes(drill.id)}
            favoriteBusy={favoriteBusyId === drill.id}
            onOpen={() => setSelectedDrill(drill)}
            onToggleFavorite={() => void toggleFavorite(drill)}
          />
        )) : null}
        {!favoritesLoading && !activeDrills.length ? (
          <section className="app-card p-5 text-sm font-semibold text-gray-500 lg:col-span-2 xl:col-span-3">
            {selectedTab === 'community'
              ? 'No drills match the current search and filter combination.'
              : 'No team favorites match the current search and filter combination.'}
          </section>
        ) : null}
      </section>

      {selectedTab === 'community' && nextCursor ? (
        <div className="flex justify-center">
          <button type="button" className="secondary-button !min-h-10 text-xs" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Load more drills
          </button>
        </div>
      ) : null}

      {selectedDrill ? (
        <DrillDetailModal
          drill={selectedDrill}
          isFavorite={favoriteIds.includes(selectedDrill.id)}
          favoriteBusy={favoriteBusyId === selectedDrill.id}
          onClose={() => setSelectedDrill(null)}
          onToggleFavorite={() => void toggleFavorite(selectedDrill)}
        />
      ) : null}
    </div>
  );
}

function DrillCard({
  drill,
  isFavorite,
  favoriteBusy,
  onOpen,
  onToggleFavorite
}: {
  drill: TeamDrillSummary;
  isFavorite: boolean;
  favoriteBusy: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const badgeColors = DRILL_TYPE_COLORS[drill.type as keyof typeof DRILL_TYPE_COLORS] || DRILL_TYPE_COLORS.Technical;

  return (
    <article className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <button type="button" aria-label={drill.title} className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-black text-gray-950">{drill.title}</h2>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] ${badgeColors.bg} ${badgeColors.text}`}>{drill.type}</span>
          </div>
          <div className="mt-1 text-xs font-semibold text-gray-500">{drill.level} · {drill.ageGroup} · {drill.setup.duration} min</div>
        </button>
        <button type="button" aria-label={isFavorite ? `Unfavorite ${drill.title}` : `Favorite ${drill.title}`} className={`inline-flex h-9 w-9 items-center justify-center rounded-full border ${isFavorite ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-gray-200 bg-white text-gray-400'}`} onClick={onToggleFavorite} disabled={favoriteBusy}>
          {favoriteBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Heart className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} aria-hidden="true" />}
        </button>
      </div>
      {drill.skills.length ? <div className="mt-3 flex flex-wrap gap-1.5">{drill.skills.slice(0, 4).map((skill) => <span key={skill} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-black text-gray-700">{skill}</span>)}</div> : null}
      {drill.description ? <p className="mt-3 text-sm font-semibold leading-6 text-gray-600">{drill.description}</p> : null}
      <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-gray-500">
        {drill.setup.players ? <span>{drill.setup.players} players</span> : null}
        <span>{drill.setup.cones} cones</span>
        {drill.diagramUrls.length ? <span>{drill.diagramUrls.length} diagram{drill.diagramUrls.length === 1 ? '' : 's'}</span> : null}
      </div>
    </article>
  );
}

function DrillDetailModal({
  drill,
  isFavorite,
  favoriteBusy,
  onClose,
  onToggleFavorite
}: {
  drill: TeamDrillSummary;
  isFavorite: boolean;
  favoriteBusy: boolean;
  onClose: () => void;
  onToggleFavorite: () => void;
}) {
  const badgeColors = DRILL_TYPE_COLORS[drill.type as keyof typeof DRILL_TYPE_COLORS] || DRILL_TYPE_COLORS.Technical;
  const setupRows = [
    ['Duration', `${drill.setup.duration} min`],
    ['Players', drill.setup.players],
    ['Cones', String(drill.setup.cones)],
    ['Balls', drill.setup.balls],
    ['Area', drill.setup.area],
    ['Pinnies', drill.setup.pinnies]
  ].filter(([, value]) => value);

  return (
    <section className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/60 p-3 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] ${badgeColors.bg} ${badgeColors.text}`}>{drill.type}</div>
            <h2 className="mt-2 text-2xl font-black text-gray-950">{drill.title}</h2>
            <div className="mt-1 text-xs font-semibold text-gray-500">{drill.level} · {drill.ageGroup}</div>
          </div>
          <button type="button" className="secondary-button !min-h-8 text-xs" onClick={onClose}>Close</button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={`secondary-button !min-h-9 text-xs ${isFavorite ? '!border-rose-200 !bg-rose-50 !text-rose-700' : ''}`} onClick={onToggleFavorite} disabled={favoriteBusy}>
            {favoriteBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Heart className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} aria-hidden="true" />}
            {isFavorite ? 'Favorited' : 'Favorite'}
          </button>
          {drill.youtubeUrl ? (
            <button type="button" className="secondary-button !min-h-9 text-xs" onClick={() => openPublicUrl(drill.youtubeUrl)}>
              Video link
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {drill.skills.length ? <div className="mt-4 flex flex-wrap gap-1.5">{drill.skills.map((skill) => <span key={skill} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-black text-gray-700">{skill}</span>)}</div> : null}

        {setupRows.length ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {setupRows.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">{label}</div>
                <div className="mt-1 text-sm font-black text-gray-950">{value}</div>
              </div>
            ))}
          </div>
        ) : null}

        {drill.description ? (
          <div className="mt-5">
            <div className="text-sm font-black text-gray-950">Description</div>
            <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">{drill.description}</p>
          </div>
        ) : null}

        {drill.instructions ? (
          <div className="mt-5">
            <div className="text-sm font-black text-gray-950">Setup & instructions</div>
            <div className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-gray-600">{drill.instructions}</div>
          </div>
        ) : null}

        {drill.diagramUrls.length ? (
          <div className="mt-5">
            <div className="text-sm font-black text-gray-950">Media & diagrams</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {drill.diagramUrls.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`${drill.title} diagram ${index + 1}`} className="w-full rounded-2xl border border-gray-200 object-cover" />)}
            </div>
          </div>
        ) : null}

        {drill.attribution?.license || drill.attribution?.source || drill.attribution?.url ? (
          <div className="mt-5 rounded-2xl border border-primary-100 bg-primary-50 p-3 text-xs font-semibold text-primary-900">
            <div className="font-black">Attribution</div>
            <div className="mt-1">{[drill.attribution.source, drill.attribution.license].filter(Boolean).join(' · ')}</div>
            {drill.attribution.url ? (
              <button type="button" className="ghost-button mt-2 !min-h-8 px-0 text-xs text-primary-700" onClick={() => openPublicUrl(drill.attribution!.url)}>
                Open source
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StatusCard({ title, message, backTo }: { title: string; message: string; backTo: string }) {
  return (
    <section className="app-card p-5">
      <div className="flex items-start gap-3">
        <Shield className="mt-0.5 h-5 w-5 flex-none text-rose-600" aria-hidden="true" />
        <div>
          <div className="text-sm font-black text-gray-950">{title}</div>
          <div className="mt-1 text-sm font-semibold text-gray-600">{message}</div>
          <Link to={backTo} className="secondary-button mt-3 !min-h-9 text-xs">Back</Link>
        </div>
      </div>
    </section>
  );
}
