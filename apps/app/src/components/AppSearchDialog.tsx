import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Search, X } from 'lucide-react';
import { derivePrimaryHelpRole } from '../lib/helpRoles';
import { isNativeRuntime } from '../lib/nativeRuntime';
import { openPublicUrl } from '../lib/publicActions';
import { preloadSearchRoute } from '../lib/searchRoutePreload';
import {
  computeAppSearchResults,
  getImmediateAppTeamSearchResults,
  getKnownAppSearchTeams,
  loadAppSearchTeams,
  searchAppTeams,
  searchAppPlayers,
  type AppSearchItem,
  type AppSearchPlayer,
  type AppSearchTeam
} from '../lib/searchService';
import type { AuthState } from '../lib/types';

type AppSearchDialogProps = {
  auth: AuthState;
  open: boolean;
  onClose: () => void;
};

const backdropCloseGuardMs = 750;
const hydrationSearchFallbackMs = 250;
const keyboardInsetActivationThresholdPx = 80;
const remotePlayerSearchCoalesceMs = 120;

export function AppSearchDialog({ auth, open, onClose }: AppSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [teams, setTeams] = useState<AppSearchTeam[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState('');
  const [players, setPlayers] = useState<AppSearchPlayer[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playersError, setPlayersError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const searchRequestId = useRef(0);
  const playerSearchGenerationRef = useRef(0);
  const playerSearchTimeoutRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const openedAtRef = useRef(Date.now());
  const preloadedRoutesRef = useRef(new Set<string>());
  const baseTeamsRef = useRef<AppSearchTeam[]>([]);
  const hydratedTeamsPromiseRef = useRef<Promise<AppSearchTeam[]> | null>(null);
  const navigate = useNavigate();
  const helpRoleFilter = derivePrimaryHelpRole(auth);

  const results = useMemo(
    () => computeAppSearchResults({ queryText: query, auth, teams, players, helpRoleFilter }),
    [auth, helpRoleFilter, players, query, teams]
  );
  const helpResults = results.help ?? [];
  const flatResults = results.flat ?? [...results.actions, ...results.teams, ...helpResults, ...results.players];

  const clearScheduledPlayerSearch = () => {
    if (playerSearchTimeoutRef.current === null) return;
    window.clearTimeout(playerSearchTimeoutRef.current);
    playerSearchTimeoutRef.current = null;
  };

  useEffect(() => {
    if (!open) return;
    openedAtRef.current = Date.now();
    preloadedRoutesRef.current = new Set<string>();
    hydratedTeamsPromiseRef.current = null;
    setQuery('');
    setPlayers([]);
    setPlayersError('');
    setPlayersLoading(false);
    clearScheduledPlayerSearch();
    const knownTeams = getKnownAppSearchTeams(auth.user);
    baseTeamsRef.current = knownTeams;
    setTeams(knownTeams);
    setActiveIndex(0);
    setTeamsLoading(false);
    setTeamsError('');
  }, [auth.user, open]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const trimmedQuery = query.trim();
    const requestId = ++searchRequestId.current;
    clearScheduledPlayerSearch();

    if (trimmedQuery.length < 2) {
      setTeams(baseTeamsRef.current);
      setTeamsLoading(false);
      setTeamsError('');
      setPlayers([]);
      setPlayersLoading(false);
      setPlayersError('');
      return () => {
        disposed = true;
        clearScheduledPlayerSearch();
      };
    }

    const initialAccessibleTeams = baseTeamsRef.current;
    const setImmediateTeamResults = (accessibleTeams: AppSearchTeam[]) => {
      const localTeams = getImmediateAppTeamSearchResults(trimmedQuery, accessibleTeams);
      setTeams(localTeams);
      setTeamsLoading(localTeams.length === 0);
      setTeamsError('');
    };

    setImmediateTeamResults(initialAccessibleTeams);
    setPlayers([]);
    setPlayersLoading(true);
    setPlayersError('');
    const timeoutId = window.setTimeout(() => {
      const schedulePlayerSearch = (accessibleTeams: AppSearchTeam[]) => {
        clearScheduledPlayerSearch();
        const generation = ++playerSearchGenerationRef.current;
        playerSearchTimeoutRef.current = window.setTimeout(async () => {
          playerSearchTimeoutRef.current = null;
          if (disposed || requestId !== searchRequestId.current || generation !== playerSearchGenerationRef.current) return;
          const accessibleTeamsById = new Map(accessibleTeams.map((team) => [team.id, team]));
          const [playersResult] = await Promise.allSettled([
            searchAppPlayers(trimmedQuery, accessibleTeamsById, auth.user)
          ]) as [PromiseSettledResult<AppSearchPlayer[]>];

          if (disposed || requestId !== searchRequestId.current || generation !== playerSearchGenerationRef.current) return;
          if (playersResult.status === 'fulfilled') {
            setPlayers(playersResult.value);
            setPlayersError('');
          } else {
            setPlayers([]);
            setPlayersError(getPlayerSearchError(playersResult.reason));
          }
          setPlayersLoading(false);
        }, remotePlayerSearchCoalesceMs);
      };

      const applyTeamResults = (teamsResult: PromiseSettledResult<AppSearchTeam[]>) => {
        if (disposed || requestId !== searchRequestId.current) return;
        if (teamsResult.status === 'fulfilled') {
          setTeams(teamsResult.value);
          setTeamsError('');
          return;
        }
        setTeams([]);
        setTeamsError(teamsResult.reason?.message || 'Team search unavailable.');
      };

      const runSearch = async (accessibleTeams: AppSearchTeam[]) => {
        if (disposed || requestId !== searchRequestId.current) return;
        setImmediateTeamResults(accessibleTeams);
        schedulePlayerSearch(accessibleTeams);

        const [teamsResult] = await Promise.allSettled([
          searchAppTeams(trimmedQuery, accessibleTeams, auth.user)
        ]) as [PromiseSettledResult<AppSearchTeam[]>];
        applyTeamResults(teamsResult);
        if (!disposed && requestId === searchRequestId.current) {
          setTeamsLoading(false);
        }
      };

      let hydrationPromise = hydratedTeamsPromiseRef.current;
      if (!hydrationPromise) {
        hydrationPromise = loadAppSearchTeams(auth.user)
          .then((loadedTeams) => mergeSearchTeams(initialAccessibleTeams, loadedTeams));
        hydratedTeamsPromiseRef.current = hydrationPromise;
      }

      const resolveAccessibleTeams = async () => {
        // Keep search bounded when Firestore hydration is slow, then retry once the
        // hydrated team scope arrives so remote team and player results do not stall.
        return Promise.race([
          hydrationPromise
            .then((hydratedTeams) => ({ teams: hydratedTeams, resolved: true }))
            .catch(() => ({ teams: initialAccessibleTeams, resolved: true })),
          new Promise<{ teams: AppSearchTeam[]; resolved: false }>((resolve) => {
            window.setTimeout(() => resolve({ teams: initialAccessibleTeams, resolved: false }), hydrationSearchFallbackMs);
          })
        ]);
      };

      void resolveAccessibleTeams()
        .then(async ({ teams: accessibleTeams, resolved }) => {
          if (disposed || requestId !== searchRequestId.current) return;
          if (resolved) {
            baseTeamsRef.current = accessibleTeams;
            await runSearch(accessibleTeams);
            return;
          }

          await runSearch(accessibleTeams);

          try {
            const hydratedTeams = await hydrationPromise;
            if (disposed || requestId !== searchRequestId.current) return;
            baseTeamsRef.current = hydratedTeams;
            if (haveSameSearchTeamSearchData(accessibleTeams, hydratedTeams)) return;
            await runSearch(hydratedTeams);
          } catch {
            if (disposed || requestId !== searchRequestId.current) return;
          }
        })
        .catch(() => {
          if (!disposed && requestId === searchRequestId.current) {
            setTeamsLoading(false);
            setPlayersLoading(false);
            clearScheduledPlayerSearch();
          }
        });
    }, 180);

    return () => {
      disposed = true;
      window.clearTimeout(timeoutId);
      clearScheduledPlayerSearch();
    };
  }, [auth.user, open, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setKeyboardInset(0);
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    const visualViewport = window.visualViewport;

    if (!isNativeRuntime() || !visualViewport) {
      setKeyboardInset(0);
      return;
    }

    const updateKeyboardInset = () => {
      const viewportBottom = visualViewport.height + visualViewport.offsetTop;
      const obscuredHeight = Math.max(0, window.innerHeight - viewportBottom);
      setKeyboardInset(obscuredHeight >= keyboardInsetActivationThresholdPx ? Math.round(obscuredHeight) : 0);
    };

    updateKeyboardInset();
    visualViewport.addEventListener('resize', updateKeyboardInset);
    visualViewport.addEventListener('scroll', updateKeyboardInset);
    window.addEventListener('resize', updateKeyboardInset);

    return () => {
      visualViewport.removeEventListener('resize', updateKeyboardInset);
      visualViewport.removeEventListener('scroll', updateKeyboardInset);
      window.removeEventListener('resize', updateKeyboardInset);
      setKeyboardInset(0);
    };
  }, [open]);

  useEffect(() => {
    if (activeIndex >= flatResults.length) {
      setActiveIndex(Math.max(0, flatResults.length - 1));
    }
  }, [activeIndex, flatResults.length]);

  if (!open) return null;

  const searchOverlayStyle = {
    '--app-search-keyboard-inset': `${keyboardInset}px`
  } as CSSProperties;

  const preloadResultRoute = (item: AppSearchItem | undefined) => {
    const route = item?.route;
    if (!route || preloadedRoutesRef.current.has(route)) return;
    preloadedRoutesRef.current.add(route);
    void preloadSearchRoute(route);
  };

  const setActiveResultIndex = (index: number) => {
    setActiveIndex(index);
    preloadResultRoute(flatResults[index]);
  };

  const openResult = async (item: AppSearchItem | undefined) => {
    if (!item) return;
    onClose();
    setQuery('');
    if (item.route) {
      preloadResultRoute(item);
      navigate(item.route);
      return;
    }
    if (item.href) {
      void openPublicUrl(item.href);
    }
  };

  const openHelpPortal = () => {
    const trimmedQuery = query.trim();
    onClose();
    setQuery('');
    navigate('/help', {
      state: {
        helpQuery: trimmedQuery,
        helpRoleFilter
      }
    });
  };

  const clearQuery = () => {
    searchRequestId.current += 1;
    clearScheduledPlayerSearch();
    setQuery('');
    searchInputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = Math.min(flatResults.length - 1, activeIndex + 1);
      setActiveResultIndex(nextIndex);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = Math.max(0, activeIndex - 1);
      setActiveResultIndex(nextIndex);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      openResult(flatResults[activeIndex]);
    }
  };

  const hasRealQuery = query.trim().length >= 2;
  const teamsStatus = hasRealQuery
    ? teamsLoading
      ? 'Searching teams...'
      : teamsError
        ? teamsError
        : results.teams.length === 0
          ? 'No matching teams'
          : ''
    : teamsError;
  const helpStatus = hasRealQuery && helpResults.length === 0
    ? 'No matching help articles'
    : '';
  const playersStatus = !hasRealQuery
    ? 'Type at least 2 characters to search players'
    : playersLoading
      ? 'Searching players...'
      : playersError
        ? playersError
        : results.players.length === 0
          ? 'No matching players'
          : '';

  return (
    <div
      className="app-search-overlay fixed inset-0 z-50 bg-gray-950/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-search-dialog-title"
      data-keyboard-visible={keyboardInset > 0 ? 'true' : 'false'}
      style={searchOverlayStyle}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (Date.now() - openedAtRef.current < backdropCloseGuardMs) return;
        onClose();
      }}
    >
      <div className="app-search-panel mx-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-app-lg" data-testid="app-search-panel">
        <div className="border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white p-3 md:p-4">
          <h2 id="app-search-dialog-title" className="sr-only">Search teams, players, actions, and help</h2>
          <div className="flex items-center gap-2 md:gap-3">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-primary-100 bg-primary-50 text-primary-700">
              <Search className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="relative">
                <input
                  ref={searchInputRef}
                  autoFocus
                  type="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-gray-200 px-3 pr-11 text-base font-semibold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                  placeholder="Search teams, players, actions, help..."
                  aria-label="Search teams, players, actions, help"
                />
                {query ? (
                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-200"
                    onClick={clearQuery}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.stopPropagation();
                      }
                    }}
                    aria-label="Clear search query"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <div className="mt-2 hidden text-xs font-semibold text-gray-500 sm:block">
                Use arrow keys to move, Enter to open, Esc to close.
              </div>
            </div>
            <button
              type="button"
              className="ghost-button !h-11 !min-h-11 !w-11 !p-0"
              onClick={onClose}
              aria-label="Close search"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-3 md:p-4">
          <div className="space-y-5">
            <SearchSection
              title="Actions"
              items={results.actions}
              activeIndex={activeIndex}
              offset={0}
              onOpen={openResult}
              onHover={setActiveResultIndex}
            />

            <SearchSection
              title="Teams"
              items={results.teams}
              activeIndex={activeIndex}
              offset={results.actions.length}
              status={teamsStatus}
              statusTone={teamsError ? 'error' : 'neutral'}
              onOpen={openResult}
              onHover={setActiveResultIndex}
            />

            <SearchSection
              title="Help"
              items={helpResults}
              activeIndex={activeIndex}
              offset={results.actions.length + results.teams.length}
              status={helpStatus}
              headerAccessory={hasRealQuery ? (
                <button
                  type="button"
                  className="text-xs font-extrabold text-primary-700 transition hover:text-primary-800"
                  onClick={openHelpPortal}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.stopPropagation();
                    }
                  }}
                >
                  More help results
                </button>
              ) : null}
              onOpen={openResult}
              onHover={setActiveResultIndex}
            />

            <SearchSection
              title="Players"
              items={results.players}
              activeIndex={activeIndex}
              offset={results.actions.length + results.teams.length + helpResults.length}
              status={playersStatus}
              statusTone={playersError ? 'error' : 'neutral'}
              onOpen={openResult}
              onHover={setActiveResultIndex}
            />

            {!teamsLoading && !playersLoading && flatResults.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm font-semibold text-gray-500">
                No results
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchSection({
  title,
  items,
  activeIndex,
  offset,
  status = '',
  statusTone = 'neutral',
  headerAccessory,
  onOpen,
  onHover
}: {
  title: string;
  items: AppSearchItem[];
  activeIndex: number;
  offset: number;
  status?: string;
  statusTone?: 'neutral' | 'error';
  headerAccessory?: ReactNode;
  onOpen: (item: AppSearchItem) => void;
  onHover: (index: number) => void;
}) {
  if (!items.length && !status) return null;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="text-xs font-extrabold uppercase tracking-[0.04em] text-gray-500">{title}</div>
        {headerAccessory}
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <SearchResultRow
            key={item.id}
            item={item}
            active={activeIndex === offset + index}
            onOpen={() => onOpen(item)}
            onHover={() => onHover(offset + index)}
          />
        ))}
      </div>
      {status ? (
        <div className={`px-1 py-2 text-sm font-semibold ${statusTone === 'error' ? 'text-rose-700' : 'text-gray-500'}`}>
          {status}
        </div>
      ) : null}
    </section>
  );
}

function SearchResultRow({ item, active, onOpen, onHover }: {
  item: AppSearchItem;
  active: boolean;
  onOpen: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      className={`w-full rounded-xl border px-4 py-3 text-left transition ${
        active ? 'border-primary-200 bg-primary-50' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
      onClick={onOpen}
      onMouseEnter={onHover}
      data-app-search-result="1"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-black text-gray-950">{item.title}</span>
          {item.subtitle ? <span className="mt-0.5 block truncate text-xs font-semibold text-gray-500">{item.subtitle}</span> : null}
          {item.kind === 'help' && item.roles?.length ? (
            <span className="mt-2 flex flex-wrap gap-1">
              {item.roles.slice(0, 3).map((role) => (
                <span key={role} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.04em] text-gray-500">
                  {role}
                </span>
              ))}
            </span>
          ) : null}
        </span>
        <span className="flex flex-none items-center gap-2">
          <span className="pt-1 text-[10px] font-extrabold uppercase tracking-[0.04em] text-gray-400">{item.kind}</span>
          <ChevronRight className="mt-0.5 h-4 w-4 text-gray-300" aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}

function mergeSearchTeams(...teamLists: AppSearchTeam[][]) {
  const teamsById = new Map<string, AppSearchTeam>();
  teamLists.flat().forEach((team) => {
    if (team?.id) teamsById.set(team.id, team);
  });
  return Array.from(teamsById.values());
}

function haveSameSearchTeamSearchData(left: AppSearchTeam[], right: AppSearchTeam[]) {
  const leftIds = left.map((team) => team.id).filter(Boolean).sort();
  const rightIds = right.map((team) => team.id).filter(Boolean).sort();
  if (leftIds.length !== rightIds.length) return false;
  if (!leftIds.every((teamId, index) => teamId === rightIds[index])) return false;

  const rightTeamsById = new Map(right.map((team) => [team.id, team]));
  return left.every((team) => {
    const hydratedTeam = rightTeamsById.get(team.id);
    if (!hydratedTeam) return false;
    return [
      'name',
      'sport',
      'zip',
      'city',
      'state',
      'location'
    ].every((field) => String(team[field as keyof AppSearchTeam] || '') === String(hydratedTeam[field as keyof AppSearchTeam] || ''));
  });
}

function getPlayerSearchError(error: any) {
  const code = String(error?.code || '');
  if (code === 'permission-denied') {
    return 'Player search unavailable for this account.';
  }
  if (code === 'failed-precondition') {
    return String(error?.message || '').toLowerCase().includes('not ready yet')
      ? 'Player search index is building. Try again in a few minutes.'
      : 'Player search index is required.';
  }
  return error?.message || 'Player search unavailable.';
}
