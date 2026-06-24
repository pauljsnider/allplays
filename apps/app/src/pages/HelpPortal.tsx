import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LifeBuoy, Search } from 'lucide-react';
import { getHelpKnowledgeDocs, searchHelpKnowledge } from '../lib/helpKnowledgeService';

type HelpPortalRoleFilter = 'all' | 'parent' | 'coach' | 'admin' | 'member';

type HelpPortalListItem = {
  id: string;
  title: string;
  summary: string;
  roles: string[];
};

const helpRoleOptions: Array<{ value: HelpPortalRoleFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'parent', label: 'Parent' },
  { value: 'coach', label: 'Coach' },
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' }
];

export function HelpPortal() {
  const location = useLocation();
  const portalState = useMemo(() => normalizePortalState(location.state), [location.state]);
  const [query, setQuery] = useState(portalState.helpQuery);
  const [roleFilter, setRoleFilter] = useState<HelpPortalRoleFilter>(portalState.helpRoleFilter);
  const helpDocs = useMemo(() => getHelpKnowledgeDocs(), []);

  useEffect(() => {
    setQuery(portalState.helpQuery);
    setRoleFilter(portalState.helpRoleFilter);
  }, [portalState.helpQuery, portalState.helpRoleFilter]);

  const visibleDocs = useMemo<HelpPortalListItem[]>(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return helpDocs.filter((doc) => roleFilterMatches(doc.roles, roleFilter));
    }

    return searchHelpKnowledge({
      query: trimmedQuery,
      roleFilter,
      limit: helpDocs.length
    }).map((doc) => ({
      id: doc.id,
      title: doc.title,
      summary: doc.summary,
      roles: doc.roles
    }));
  }, [helpDocs, query, roleFilter]);

  const selectedRoleLabel = helpRoleOptions.find((option) => option.value === roleFilter)?.label || 'All';
  const hasFilters = Boolean(query.trim()) || roleFilter !== 'all';

  return (
    <div className="space-y-4">
      <section className="app-card overflow-hidden">
        <div className="border-b border-gray-200 bg-gradient-to-r from-primary-50 to-white p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-white text-primary-700 shadow-sm ring-1 ring-primary-100">
              <LifeBuoy className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="text-xs font-extrabold uppercase tracking-[0.04em] text-primary-700">Help portal</div>
              <h1 className="mt-2 text-2xl font-black text-gray-950">Find guides without leaving the app</h1>
              <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
                Search packaged help content, filter it by role, and open articles directly in ALL PLAYS.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="block">
              <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Search help</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search help articles"
                  aria-label="Search help articles"
                  className="min-h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-sm font-semibold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                />
              </span>
            </label>

            <div>
              <div className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Role filter</div>
              <div className="flex flex-wrap gap-1.5" aria-label="Filter help by role">
                {helpRoleOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs font-extrabold transition ${
                      roleFilter === option.value
                        ? 'border-primary-300 bg-primary-50 text-primary-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                    aria-pressed={roleFilter === option.value}
                    onClick={() => setRoleFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-500">
          {visibleDocs.length} article{visibleDocs.length === 1 ? '' : 's'}
          {roleFilter !== 'all' ? ` for ${selectedRoleLabel}` : ''}
          {query.trim() ? ` matching “${query.trim()}”` : ''}
        </div>

        <div className="p-5">
          {visibleDocs.length ? (
            <div className="space-y-3">
              {visibleDocs.map((doc) => (
                <Link
                  key={doc.id}
                  to={`/help/${doc.id}`}
                  state={{ fromHelpPortal: true, helpQuery: query, helpRoleFilter: roleFilter }}
                  className="block rounded-2xl border border-gray-200 bg-white p-4 transition hover:border-primary-200 hover:bg-primary-50/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-black text-gray-950">{doc.title}</h2>
                      <p className="mt-1 text-sm font-semibold leading-6 text-gray-600">{doc.summary}</p>
                      {doc.roles.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5" aria-label={`${doc.title} roles`}>
                          {doc.roles.map((role) => (
                            <span key={role} className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.04em] text-gray-500">
                              {role}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <span className="text-xs font-extrabold uppercase tracking-[0.04em] text-primary-700">Open</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-primary-700 shadow-sm ring-1 ring-gray-200">
                <Search className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-3 text-lg font-black text-gray-950">No help articles match this filter</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
                {hasFilters
                  ? `Try a different search term or switch the role filter from ${selectedRoleLabel}.`
                  : 'Try another search term or role filter.'}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function normalizePortalState(state: unknown) {
  const candidate = state as { helpQuery?: string; helpRoleFilter?: HelpPortalRoleFilter } | null;
  return {
    helpQuery: typeof candidate?.helpQuery === 'string' ? candidate.helpQuery : '',
    helpRoleFilter: isRoleFilter(candidate?.helpRoleFilter) ? candidate.helpRoleFilter : 'all'
  };
}

function isRoleFilter(value: unknown): value is HelpPortalRoleFilter {
  return helpRoleOptions.some((option) => option.value === value);
}

function roleFilterMatches(roles: string[], roleFilter: HelpPortalRoleFilter) {
  if (roleFilter === 'all') return true;
  const normalizedRoles = roles.map((role) => role.toLowerCase());
  return normalizedRoles.includes('all') || normalizedRoles.includes(roleFilter);
}
