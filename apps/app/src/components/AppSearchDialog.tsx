import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Search, X } from 'lucide-react';
import { openPublicUrl } from '../lib/publicActions';
import {
  computeAppSearchResults,
  loadAppSearchTeams,
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

type HelpRoleFilter = 'all' | 'parent' | 'coach' | 'admin' | 'member';

const helpRoleFilters: { value: HelpRoleFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'parent', label: 'Parent' },
  { value: 'coach', label: 'Coach' },
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' }
];

export function AppSearchDialog({ auth, open, onClose }: AppSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [teams, setTeams] = useState<AppSearchTeam[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState('');
  const [players, setPlayers] = useState<AppSearchPlayer[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playersError, setPlayersError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedHelpRole, setSelectedHelpRole] = useState<HelpRoleFilter>('all');
  const searchRequestId = useRef(0);
  const navigate = useNavigate();

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const results = useMemo(() => computeAppSearchResults({ queryText: query, auth, teams, players }), [auth, players, query, teams]);
  const helpResults = useMemo(() => {
    const matchingHelp = results.help ?? [];
    if (selectedHelpRole === 'all') return matchingHelp;
    return matchingHelp.filter((item) => item.roles?.includes(selectedHelpRole));
  }, [results.help, selectedHelpRole]);
  const flatResults = useMemo(
    () => [...results.actions, ...results.teams, ...helpResults, ...results.players],
    [helpResults, results.actions, results.players, results.teams]
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setPlayers([]);
    setPlayersError('');
    setPlayersLoading(false);
    setActiveIndex(0);
    setSelectedHelpRole('all');
    setTeamsLoading(true);
    setTeamsError('');

    let cancelled = false;
    loadAppSearchTeams(auth.user)
      .then((loadedTeams) => {
        if (cancelled) return;
        setTeams(loadedTeams);
      })
      .catch((error: any) => {
        if (cancelled) return;
        setTeams([]);
        setTeamsError(error?.message || 'Unable to load teams.');
      })
      .finally(() => {
        if (!cancelled) setTeamsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [auth.user, open]);

  useEffect(() => {
    if (!open) return;
    const trimmedQuery = query.trim();
    const requestId = ++searchRequestId.current;

    if (trimmedQuery.length < 2) {
      setPlayers([]);
      setPlayersLoading(false);
      setPlayersError('');
      return;
    }

    setPlayersLoading(true);
    setPlayersError('');
    const timeoutId = window.setTimeout(() => {
      searchAppPlayers(trimmedQuery, teamsById, auth.user)
        .then((matchedPlayers) => {
          if (requestId !== searchRequestId.current) return;
          setPlayers(matchedPlayers);
        })
        .catch((error: any) => {
          if (requestId !== searchRequestId.current) return;
          setPlayers([]);
          setPlayersError(getPlayerSearchError(error));
        })
        .finally(() => {
          if (requestId === searchRequestId.current) setPlayersLoading(false);
        });
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [auth.user, open, query, teamsById]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, selectedHelpRole]);

  useEffect(() => {
    if (activeIndex >= flatResults.length) {
      setActiveIndex(Math.max(0, flatResults.length - 1));
    }
  }, [activeIndex, flatResults.length]);

  if (!open) return null;

  const openResult = (item: AppSearchItem | undefined) => {
    if (!item) return;
    onClose();
    setQuery('');
    if (item.route) {
      navigate(item.route);
      return;
    }
    if (item.href) {
      void openPublicUrl(item.href);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((value) => Math.min(flatResults.length - 1, value + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((value) => Math.max(0, value - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      openResult(flatResults[activeIndex]);
    }
  };

  const teamsStatus = teamsLoading
    ? 'Loading teams...'
    : teamsError
      ? teamsError
      : results.teams.length === 0
        ? 'No matching teams'
        : '';
  const helpStatus = query.trim().length >= 2 && helpResults.length === 0
    ? 'No matching help articles'
    : '';
  const playersStatus = playersLoading
    ? 'Searching players...'
    : playersError
      ? playersError
      : query.trim().length < 2
        ? 'Type at least 2 characters to search players'
        : results.players.length === 0
          ? 'No matching players'
          : '';

  return (
    <div
      className="app-search-overlay fixed inset-0 z-50 bg-gray-950/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Search teams, players, actions, and help"
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="app-search-panel mx-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-app-lg" data-testid="app-search-panel">
        <div className="border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white p-3 md:p-4">
          <div className="flex items-center gap-2 md:gap-3">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-primary-100 bg-primary-50 text-primary-700">
              <Search className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-gray-200 px-3 text-base font-semibold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                placeholder="Search teams, players, actions, help..."
                aria-label="Search teams, players, actions, help"
              />
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
              onHover={setActiveIndex}
            />

            <SearchSection
              title="Teams"
              items={results.teams}
              activeIndex={activeIndex}
              offset={results.actions.length}
              status={teamsStatus}
              statusTone={teamsError ? 'error' : 'neutral'}
              onOpen={openResult}
              onHover={setActiveIndex}
            />

            <SearchSection
              title="Help"
              items={helpResults}
              activeIndex={activeIndex}
              offset={results.actions.length + results.teams.length}
              status={helpStatus}
              headerAccessory={
                <HelpRoleFilterChips
                  selectedRole={selectedHelpRole}
                  onChange={setSelectedHelpRole}
                />
              }
              onOpen={openResult}
              onHover={setActiveIndex}
            />

            <SearchSection
              title="Players"
              items={results.players}
              activeIndex={activeIndex}
              offset={results.actions.length + results.teams.length + helpResults.length}
              status={playersStatus}
              statusTone={playersError ? 'error' : 'neutral'}
              onOpen={openResult}
              onHover={setActiveIndex}
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


function HelpRoleFilterChips({ selectedRole, onChange }: {
  selectedRole: HelpRoleFilter;
  onChange: (role: HelpRoleFilter) => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1" role="group" aria-label="Filter help by role">
      {helpRoleFilters.map((option) => {
        const selected = selectedRole === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={`min-h-9 rounded-full border px-3 py-1 text-[11px] font-extrabold transition ${
              selected
                ? 'border-primary-600 bg-primary-600 text-white shadow-sm'
                : 'border-gray-200 bg-white text-gray-600 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700'
            }`}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
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
