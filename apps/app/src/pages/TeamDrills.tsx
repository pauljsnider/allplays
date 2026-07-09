import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ExternalLink, Heart, Loader2, Save, Search, Shield, Sparkles } from 'lucide-react';
import { DRILL_LEVELS, DRILL_TYPES, DRILL_TYPE_COLORS } from '../lib/adapters/legacyDrills';
import type { PracticeAiCoachPlanResult } from '../lib/practiceAiCoachService';
import { getPracticeTimelineTotalMinutes, loadPracticeTimelineModel, savePracticeTimelineForApp, type PracticeTimelineBlock, type PracticeTimelineModel } from '../lib/practiceTimelineService';
import { isRetryableAppServiceError, toAppServiceError } from '../lib/appErrors';
import { openPublicUrl } from '../lib/publicActions';
import { filterDrillSummaries, loadFavoriteDrills, loadTeamDrillLibraryPage, setTeamDrillFavorite, type TeamDrillSummary } from '../lib/teamDrillsService';
import { useAppAsyncOperation } from '../lib/useAsyncOperation';
import type { AuthState } from '../lib/types';

type DrillTab = 'community' | 'favorites';

const drillTypeOptions = DRILL_TYPES as string[];
const drillLevelOptions = DRILL_LEVELS as string[];

function loadPracticeAiCoachService() {
  return import('../lib/practiceAiCoachService');
}

function mergeUniqueDrills(drills: TeamDrillSummary[]) {
  return Array.from(new Map(drills.map((drill) => [drill.id, drill])).values());
}

export function TeamDrills({ auth }: { auth: AuthState }) {
  const { teamId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const eventIdFromUrl = searchParams.get('eventId') || '';
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
  const [practiceEventId, setPracticeEventId] = useState(eventIdFromUrl);
  const [practiceModel, setPracticeModel] = useState<PracticeTimelineModel | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceError, setPracticeError] = useState('');
  const [coachRequest, setCoachRequest] = useState('Build a balanced practice focused on shooting and finishing.');
  const [coachMinutes, setCoachMinutes] = useState('60');
  const [coachSkillLevel, setCoachSkillLevel] = useState('');
  const [coachGenerating, setCoachGenerating] = useState(false);
  const [coachProposal, setCoachProposal] = useState<PracticeAiCoachPlanResult | null>(null);
  const [coachAcceptMode, setCoachAcceptMode] = useState<'replace' | 'append'>('replace');
  const [coachSaving, setCoachSaving] = useState(false);
  const [coachStatus, setCoachStatus] = useState('');
  const { error: loadError, clearError: clearLoadError, run: runLoadOperation } = useAppAsyncOperation();
  const authAccessKey = [
    auth.user?.uid || '',
    String(auth.user?.email || '').trim().toLowerCase(),
    auth.user?.isAdmin === true ? 'admin' : 'user'
  ].join('|');

  useEffect(() => {
    let cancelled = false;

    async function loadInitialPage() {
      if (!teamId) return;
      setLoading(true);
      setError('');
      await runLoadOperation(
        () => loadTeamDrillLibraryPage(teamId, auth.user, {
          searchText,
          type: typeFilter,
          level: levelFilter
        }),
        {
          fallbackMessage: 'Unable to load the community drill library.',
          onSuccess: (page) => {
            if (cancelled) return;
            setTeamName(page.team.name);
            setTeamSport(page.team.sport);
            setCanManageDrills(page.canManageDrills);
            setCommunityDrills(page.drills);
            setFavoriteIds(page.favoriteIds);
            setNextCursor(page.nextCursor);
            setFavoriteDrills(null);
          },
          onError: (nextError) => {
            if (cancelled) return;
            setError(nextError.message);
            setCommunityDrills([]);
            setFavoriteIds([]);
            setNextCursor(null);
            setFavoriteDrills(null);
          },
          onFinally: () => {
            if (!cancelled) setLoading(false);
          }
        }
      );
    }

    void loadInitialPage();
    return () => {
      cancelled = true;
    };
  }, [authAccessKey, levelFilter, searchText, teamId, typeFilter]);

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
        setError(toAppServiceError(loadError, 'Unable to load favorite drills.').message);
      } finally {
        if (!cancelled) setFavoritesLoading(false);
      }
    }

    void loadFavoritesForTab();
    return () => {
      cancelled = true;
    };
  }, [authAccessKey, canManageDrills, favoriteDrills, selectedTab, teamId]);

  useEffect(() => {
    if (eventIdFromUrl) {
      setPracticeEventId(eventIdFromUrl);
    }
  }, [eventIdFromUrl]);

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
      setCommunityDrills((current) => mergeUniqueDrills([...current, ...page.drills]));
      setFavoriteIds(page.favoriteIds);
      setNextCursor(page.nextCursor);
    } catch (loadError: any) {
      setError(toAppServiceError(loadError, 'Unable to load more drills.').message);
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
      setError(toAppServiceError(toggleError, 'Unable to update drill favorite.').message);
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

  async function loadPracticeSession() {
    const eventId = practiceEventId.trim();
    if (!eventId) {
      setPracticeError('Enter a practice event ID before loading the AI coach context.');
      return;
    }

    setPracticeLoading(true);
    setPracticeError('');
    setCoachStatus('');
    setCoachProposal(null);
    try {
      const model = await loadPracticeTimelineModel(teamId, eventId, auth.user);
      setPracticeModel(model);
      const currentMinutes = getPracticeTimelineTotalMinutes(model.blocks);
      setCoachMinutes(String(currentMinutes || 60));
      setCoachAcceptMode(model.blocks.length ? 'append' : 'replace');
    } catch (loadError: any) {
      setPracticeModel(null);
      setPracticeError(toAppServiceError(loadError, 'Unable to load that practice session.').message);
    } finally {
      setPracticeLoading(false);
    }
  }

  async function generateCoachProposal() {
    if (!practiceModel) {
      setPracticeError('Load an existing practice session before asking the AI coach for a timeline.');
      return;
    }

    setCoachGenerating(true);
    setPracticeError('');
    setCoachStatus('');
    setCoachProposal(null);
    try {
      const favoriteContextDrills = (favoriteDrills || communityDrills.filter((drill) => favoriteIds.includes(drill.id))).slice(0, 10);
      const { generatePracticeAiCoachPlan } = await loadPracticeAiCoachService();
      const result = await generatePracticeAiCoachPlan({
        teamName: practiceModel.teamName || teamName,
        sport: practiceModel.teamSport || teamSport,
        skillLevel: coachSkillLevel,
        targetMinutes: coachMinutes,
        coachRequest,
        currentBlocks: practiceModel.blocks,
        drillOptions: practiceModel.drillOptions,
        favoriteDrills: favoriteContextDrills,
        planScope: practiceModel.blocks.length ? 'append' : 'full-session'
      });
      if (result.errors.length) {
        setPracticeError(result.errors[0]);
        return;
      }
      setCoachProposal(result);
    } catch (coachError: any) {
      setPracticeError(toAppServiceError(coachError, 'AI practice coach could not generate a proposal. Try again.').message);
    } finally {
      setCoachGenerating(false);
    }
  }

  function updateProposalBlock(index: number, patch: Partial<PracticeTimelineBlock>) {
    setCoachProposal((current) => {
      if (!current) return current;
      return {
        ...current,
        blocks: current.blocks.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } : block)
      };
    });
  }

  async function acceptCoachProposal() {
    if (!practiceModel || !coachProposal?.blocks.length || coachSaving) return;
    const proposedBlocks = coachProposal.blocks.map((block, index) => ({
      ...block,
      duration: Math.max(1, Number.parseInt(String(block.duration), 10) || 1),
      order: index
    }));
    const nextBlocks = (coachAcceptMode === 'append' ? [...practiceModel.blocks, ...proposedBlocks] : proposedBlocks)
      .map((block, index) => ({ ...block, order: index }));
    const modeLabel = coachAcceptMode === 'append' ? 'append these AI blocks to' : 'replace';
    if (!window.confirm(`Accept this AI proposal and ${modeLabel} the practice timeline?`)) return;

    setCoachSaving(true);
    setPracticeError('');
    setCoachStatus('');
    try {
      const sessionId = await savePracticeTimelineForApp({
        teamId,
        eventId: practiceModel.eventId,
        user: auth.user,
        sessionId: practiceModel.sessionId,
        blocks: nextBlocks,
        date: practiceModel.date,
        location: practiceModel.location,
        title: `${practiceModel.teamName} practice`
      });
      setPracticeModel({
        ...practiceModel,
        sessionId,
        blocks: nextBlocks
      });
      setCoachProposal(null);
      setCoachStatus('Practice timeline updated.');
    } catch (saveError: any) {
      setPracticeError(toAppServiceError(saveError, 'Unable to save the AI practice proposal.').message);
    } finally {
      setCoachSaving(false);
    }
  }

  const activeDrills = selectedTab === 'community' ? communityDrills : visibleFavoriteDrills;
  const heading = `${teamName} drills`;
  const practiceTotalMinutes = practiceModel ? getPracticeTimelineTotalMinutes(practiceModel.blocks) : 0;
  const proposalTotalMinutes = coachProposal ? getPracticeTimelineTotalMinutes(coachProposal.blocks) : 0;

  if (loading) {
    return (
      <section className="app-card p-5 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-950">Loading drill library</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Fetching community drills without pulling the whole library at once.</div>
      </section>
    );
  }

  if ((loadError || error) && !communityDrills.length && selectedTab === 'community') {
    return <StatusCard title="Drill library unavailable" message={loadError?.message || error} backTo={`/teams/${encodeURIComponent(teamId)}`} onRetry={isRetryableAppServiceError(loadError) ? () => {
      setLoading(true);
      clearLoadError();
      setError('');
      void runLoadOperation(() => loadTeamDrillLibraryPage(teamId, auth.user, {
        searchText,
        type: typeFilter,
        level: levelFilter
      }), {
        fallbackMessage: 'Unable to load the community drill library.',
        onSuccess: (page) => {
          setTeamName(page.team.name);
          setTeamSport(page.team.sport);
          setCanManageDrills(page.canManageDrills);
          setCommunityDrills(page.drills);
          setFavoriteIds(page.favoriteIds);
          setNextCursor(page.nextCursor);
          setFavoriteDrills(null);
        },
        onError: (nextError) => {
          setError(nextError.message);
          setCommunityDrills([]);
          setFavoriteIds([]);
          setNextCursor(null);
          setFavoriteDrills(null);
        },
        onFinally: () => {
          setLoading(false);
        }
      });
    } : undefined} />;
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

      <section className="app-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.04em] text-primary-700">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              AI practice coach
            </div>
            <h2 className="mt-1 text-xl font-black text-gray-950">Build a proposed practice timeline</h2>
            <p className="mt-1 text-sm font-semibold text-gray-600">Load an existing practice event, generate a timeline proposal, edit it, then accept before anything is saved.</p>
          </div>
          {practiceModel ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-black text-gray-700">
              Current timeline: {practiceModel.blocks.length} block{practiceModel.blocks.length === 1 ? '' : 's'} · {practiceTotalMinutes} min
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Practice event ID</span>
            <input
              aria-label="Practice event ID"
              value={practiceEventId}
              onChange={(event) => setPracticeEventId(event.target.value)}
              placeholder="Paste a practice event ID"
              className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
            />
          </label>
          <button type="button" className="secondary-button self-end !min-h-10 text-xs" onClick={() => void loadPracticeSession()} disabled={practiceLoading}>
            {practiceLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Load practice
          </button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[120px_160px_minmax(0,1fr)_auto]">
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Minutes</span>
            <input
              aria-label="Target minutes"
              type="number"
              min="1"
              value={coachMinutes}
              onChange={(event) => setCoachMinutes(event.target.value)}
              className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Coach level</span>
            <select aria-label="Coach skill level" value={coachSkillLevel} onChange={(event) => setCoachSkillLevel(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100">
              <option value="">All</option>
              {drillLevelOptions.map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Practice focus</span>
            <input
              aria-label="Practice focus"
              value={coachRequest}
              onChange={(event) => setCoachRequest(event.target.value)}
              placeholder="60 min, shooting focus, 12 players..."
              className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
            />
          </label>
          <button type="button" className="primary-button self-end !min-h-10 text-xs" onClick={() => void generateCoachProposal()} disabled={!practiceModel || coachGenerating}>
            {coachGenerating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            Generate proposal
          </button>
        </div>

        {practiceError ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-black text-rose-700">{practiceError}</div> : null}
        {coachStatus ? <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-black text-emerald-700">{coachStatus}</div> : null}

        {coachProposal?.blocks.length ? (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-black text-gray-950">Proposed timeline</div>
                <div className="mt-1 text-xs font-semibold text-gray-500">{coachProposal.blocks.length} block{coachProposal.blocks.length === 1 ? '' : 's'} · {proposalTotalMinutes} min</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-black text-gray-700">
                  <input type="radio" name="coach-accept-mode" checked={coachAcceptMode === 'replace'} onChange={() => setCoachAcceptMode('replace')} />
                  Replace
                </label>
                <label className="inline-flex items-center gap-2 text-xs font-black text-gray-700">
                  <input type="radio" name="coach-accept-mode" checked={coachAcceptMode === 'append'} onChange={() => setCoachAcceptMode('append')} />
                  Append
                </label>
                <button type="button" className="primary-button !min-h-9 text-xs" onClick={() => void acceptCoachProposal()} disabled={coachSaving}>
                  {coachSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                  Accept timeline
                </button>
              </div>
            </div>
            {coachProposal.assistantMessage ? <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">{coachProposal.assistantMessage}</p> : null}
            <div className="mt-3 space-y-3">
              {coachProposal.blocks.map((block, index) => (
                <div key={`${block.drillTitle}-${index}`} className="grid gap-2 rounded-xl border border-gray-200 bg-white p-3 lg:grid-cols-[minmax(0,1fr)_100px_150px]">
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">Block {index + 1}</span>
                    <input
                      aria-label={`Proposal block ${index + 1} title`}
                      value={block.drillTitle}
                      onChange={(event) => updateProposalBlock(index, { drillTitle: event.target.value })}
                      className="mt-1 min-h-9 w-full rounded-lg border border-gray-200 px-2 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">Minutes</span>
                    <input
                      aria-label={`Proposal block ${index + 1} minutes`}
                      type="number"
                      min="1"
                      value={block.duration}
                      onChange={(event) => updateProposalBlock(index, { duration: Number.parseInt(event.target.value, 10) || 1 })}
                      className="mt-1 min-h-9 w-full rounded-lg border border-gray-200 px-2 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">Type</span>
                    <select
                      aria-label={`Proposal block ${index + 1} type`}
                      value={block.type}
                      onChange={(event) => updateProposalBlock(index, { type: event.target.value })}
                      className="mt-1 min-h-9 w-full rounded-lg border border-gray-200 px-2 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                    >
                      {drillTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  <label className="block lg:col-span-3">
                    <span className="text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">Notes</span>
                    <input
                      aria-label={`Proposal block ${index + 1} notes`}
                      value={block.notes}
                      onChange={(event) => updateProposalBlock(index, { notes: event.target.value })}
                      className="mt-1 min-h-9 w-full rounded-lg border border-gray-200 px-2 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        ) : null}
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
              {drill.diagramUrls.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`${drill.title} diagram ${index + 1}`} loading="lazy" decoding="async" className="w-full rounded-2xl border border-gray-200 object-cover" />)}
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

function StatusCard({ title, message, backTo, onRetry }: { title: string; message: string; backTo: string; onRetry?: () => void }) {
  return (
    <section className="app-card p-5">
      <div className="flex items-start gap-3">
        <Shield className="mt-0.5 h-5 w-5 flex-none text-rose-600" aria-hidden="true" />
        <div>
          <div className="text-sm font-black text-gray-950">{title}</div>
          <div className="mt-1 text-sm font-semibold text-gray-600">{message}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {onRetry ? <button type="button" className="primary-button !min-h-9 text-xs" onClick={onRetry}>Retry</button> : null}
            <Link to={backTo} className="secondary-button !min-h-9 text-xs">Back</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
