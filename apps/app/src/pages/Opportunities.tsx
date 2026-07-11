import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  MapPin,
  Megaphone,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Modal } from '../components/Modal';
import { loadParentHome } from '../lib/homeService';
import type { ParentHomeModel, ParentHomePlayer, ParentHomeTeam } from '../lib/homeLogic';
import {
  buildMatchingSummary,
  emptyMatchingFilters,
  filterMatchingPosts,
  getMatchingKindLabel,
  matchingAgeGroups,
  matchingLevels,
  MATCHING_DESCRIPTION_MAX_LENGTH,
  MATCHING_RESPONSE_MAX_LENGTH,
  type MatchingPost,
  type MatchingPostFilters,
  type MatchingPostKind,
  type MatchingPostStatus,
  type MatchingResponse
} from '../lib/matchingLogic';
import {
  createMatchingPost,
  dismissMatchingResponse,
  loadMatchingResponses,
  loadMyMatchingPosts,
  loadOpenMatchingPosts,
  respondToMatchingPost,
  setMatchingPostStatus
} from '../lib/matchingService';
import type { AuthState } from '../lib/types';

type StatusMessage = { tone: 'success' | 'error'; message: string } | null;

function isLikelyTeamAdminRole(role: string): boolean {
  const normalized = String(role || '').trim().toLowerCase();
  return normalized !== 'parent' && normalized !== 'public' && normalized !== 'fan' && normalized !== 'follower';
}

export function Opportunities({ auth }: { auth: AuthState }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [posts, setPosts] = useState<MatchingPost[]>([]);
  const [myPosts, setMyPosts] = useState<MatchingPost[]>([]);
  const [home, setHome] = useState<ParentHomeModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [filters, setFilters] = useState<MatchingPostFilters>(emptyMatchingFilters);
  const [composerKind, setComposerKind] = useState<MatchingPostKind | null>(null);
  const [respondPost, setRespondPost] = useState<MatchingPost | null>(null);
  const [view, setView] = useState<'browse' | 'mine'>(searchParams.get('view') === 'mine' ? 'mine' : 'browse');

  const refresh = async () => {
    if (!auth.user) return;
    setLoading(true);
    try {
      const [openPosts, minePosts, homeModel] = await Promise.all([
        loadOpenMatchingPosts(),
        loadMyMatchingPosts(auth.user),
        loadParentHome(auth.user).catch(() => null)
      ]);
      setPosts(openPosts);
      setMyPosts(minePosts);
      setHome(homeModel);
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to load opportunities.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  useEffect(() => {
    const compose = searchParams.get('compose');
    if (compose === 'player_seeking_team' || compose === 'team_seeking_players') {
      setComposerKind(compose);
      const next = new URLSearchParams(searchParams);
      next.delete('compose');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const visiblePosts = useMemo(() => filterMatchingPosts(posts, filters), [posts, filters]);

  const handleCreated = async (message: string) => {
    setComposerKind(null);
    setStatus({ tone: 'success', message });
    await refresh();
  };

  return (
    <div className="space-y-4">
      <section className="app-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="app-label">Community</div>
            <h1 className="mt-1 text-2xl font-black text-gray-950 sm:text-3xl">Opportunities</h1>
            <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
              Players looking for teams and teams looking for players across the ALL PLAYS community.
            </p>
          </div>
          <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !p-0" onClick={() => void refresh()} disabled={loading} aria-label="Refresh opportunities" title="Refresh opportunities">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="primary-button !min-h-10 !px-3 text-xs" onClick={() => setComposerKind('player_seeking_team')}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Player looking for team
          </button>
          <button type="button" className="primary-button !min-h-10 !px-3 text-xs" onClick={() => setComposerKind('team_seeking_players')}>
            <Megaphone className="h-4 w-4" aria-hidden="true" />
            Team looking for players
          </button>
          <button
            type="button"
            className={`ghost-button !min-h-10 !px-3 text-xs ${view === 'mine' ? '!bg-gray-950 !text-white' : ''}`}
            onClick={() => setView(view === 'mine' ? 'browse' : 'mine')}
            aria-pressed={view === 'mine'}
          >
            My posts{myPosts.length ? ` (${myPosts.length})` : ''}
          </button>
        </div>
      </section>

      {status ? <StatusBanner tone={status.tone} message={status.message} /> : null}

      {view === 'browse' ? (
        <>
          <OpportunityFilters filters={filters} onChange={setFilters} />
          <section className="space-y-3" aria-label="Open opportunities">
            {loading && !visiblePosts.length ? (
              <div className="app-card flex items-center justify-center gap-2 p-6 text-sm font-bold text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading opportunities...
              </div>
            ) : visiblePosts.length ? (
              visiblePosts.map((post) => (
                <OpportunityCard
                  key={post.id}
                  post={post}
                  isMine={post.authorId === auth.user?.uid}
                  onRespond={() => setRespondPost(post)}
                />
              ))
            ) : (
              <div className="app-card p-6 text-center">
                <Search className="mx-auto h-8 w-8 text-gray-300" aria-hidden="true" />
                <div className="mt-3 text-sm font-black text-gray-900">No open opportunities match</div>
                <div className="mt-1 text-xs font-semibold text-gray-500">Try clearing a filter, or create the first post for your sport and area.</div>
              </div>
            )}
          </section>
        </>
      ) : (
        <MyPostsSection
          posts={myPosts}
          loading={loading}
          onStatus={setStatus}
          onRefresh={refresh}
        />
      )}

      {composerKind ? (
        <OpportunityComposerModal
          kind={composerKind}
          home={home}
          onClose={() => setComposerKind(null)}
          onSubmit={async (draft) => {
            if (!auth.user) throw new Error('Sign in to create a post.');
            await createMatchingPost(auth.user, draft);
            await handleCreated('Your post is live in Opportunities.');
          }}
        />
      ) : null}

      {respondPost ? (
        <OpportunityRespondModal
          post={respondPost}
          home={home}
          onClose={() => setRespondPost(null)}
          onSubmit={async (input) => {
            if (!auth.user) throw new Error('Sign in to respond.');
            await respondToMatchingPost(auth.user, respondPost, input);
            setRespondPost(null);
            setStatus({ tone: 'success', message: 'Response sent. The poster will see it in the app.' });
          }}
        />
      ) : null}
    </div>
  );
}

function OpportunityFilters({ filters, onChange }: { filters: MatchingPostFilters; onChange: (filters: MatchingPostFilters) => void }) {
  return (
    <section className="app-card space-y-3 p-3" aria-label="Opportunity filters">
      <div className="flex min-w-max gap-1 overflow-x-auto">
        {([
          { id: 'all', label: 'All' },
          { id: 'player_seeking_team', label: 'Players seeking teams' },
          { id: 'team_seeking_players', label: 'Teams seeking players' }
        ] as Array<{ id: MatchingPostFilters['kind']; label: string }>).map((option) => (
          <button
            key={option.id}
            type="button"
            className={`min-h-8 rounded-full px-3 text-xs font-black transition ${filters.kind === option.id ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-950'}`}
            onClick={() => onChange({ ...filters, kind: option.id })}
            aria-pressed={filters.kind === option.id}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Sport</span>
          <input
            type="text"
            value={filters.sport}
            onChange={(event) => onChange({ ...filters, sport: event.target.value })}
            placeholder="Any sport"
            className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
          />
        </label>
        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Age group</span>
          <select
            value={filters.ageGroup}
            onChange={(event) => onChange({ ...filters, ageGroup: event.target.value })}
            className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
          >
            <option value="">Any age group</option>
            {matchingAgeGroups.map((ageGroup) => <option key={ageGroup} value={ageGroup}>{ageGroup}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Location</span>
          <input
            type="text"
            value={filters.location}
            onChange={(event) => onChange({ ...filters, location: event.target.value })}
            placeholder="City, state, or ZIP"
            className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
          />
        </label>
      </div>
    </section>
  );
}

function OpportunityCard({ post, isMine, onRespond }: { post: MatchingPost; isMine: boolean; onRespond: () => void }) {
  const isPlayerPost = post.kind === 'player_seeking_team';
  return (
    <article className="app-card overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl ${isPlayerPost ? 'bg-primary-600 text-white' : 'bg-gray-950 text-white'}`}>
          {isPlayerPost ? <UserPlus className="h-5 w-5" aria-hidden="true" /> : <Users className="h-5 w-5" aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-gray-700">{getMatchingKindLabel(post.kind)}</span>
            {isMine ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-amber-700">Your post</span> : null}
          </div>
          <h3 className="mt-2 text-base font-black leading-5 text-gray-950">{post.title}</h3>
          <p className="mt-1 flex items-start gap-1 text-sm font-semibold leading-5 text-gray-600">
            <MapPin className="mt-0.5 h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
            {buildMatchingSummary(post.matching)}
          </p>
          {post.description ? <p className="mt-2 rounded-xl bg-gray-50 p-3 text-sm font-semibold leading-5 text-gray-800">{post.description}</p> : null}
          <div className="mt-2 text-xs font-bold text-gray-500">Posted by {post.authorName}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50 p-3">
        {post.kind === 'team_seeking_players' && post.matching.signupUrl ? (
          <a href={post.matching.signupUrl} target="_blank" rel="noreferrer" className="primary-button !min-h-9 !px-3 text-xs">
            Team signup
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
        {!isMine ? (
          <button type="button" className="ghost-button !min-h-9 !px-3 text-xs" onClick={onRespond}>
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            I'm interested
          </button>
        ) : null}
      </div>
    </article>
  );
}

function MyPostsSection({
  posts,
  loading,
  onStatus,
  onRefresh
}: {
  posts: MatchingPost[];
  loading: boolean;
  onStatus: (status: StatusMessage) => void;
  onRefresh: () => Promise<void>;
}) {
  const [busyKey, setBusyKey] = useState('');
  const [responsesByPost, setResponsesByPost] = useState<Record<string, MatchingResponse[]>>({});

  const runStatusChange = async (post: MatchingPost, nextStatus: MatchingPostStatus) => {
    setBusyKey(`${post.id}:${nextStatus}`);
    onStatus(null);
    try {
      await setMatchingPostStatus(post.id, nextStatus);
      onStatus({ tone: 'success', message: nextStatus === 'open' ? 'Post reopened.' : `Post marked ${nextStatus}.` });
      await onRefresh();
    } catch (error: any) {
      onStatus({ tone: 'error', message: error?.message || 'Unable to update the post.' });
    } finally {
      setBusyKey('');
    }
  };

  const loadResponses = async (post: MatchingPost) => {
    setBusyKey(`${post.id}:responses`);
    try {
      const responses = await loadMatchingResponses(post.id);
      setResponsesByPost((current) => ({ ...current, [post.id]: responses }));
    } catch (error: any) {
      onStatus({ tone: 'error', message: error?.message || 'Unable to load responses.' });
    } finally {
      setBusyKey('');
    }
  };

  const dismissResponse = async (post: MatchingPost, response: MatchingResponse) => {
    setBusyKey(`${post.id}:${response.responderId}`);
    try {
      await dismissMatchingResponse(post.id, response.responderId);
      setResponsesByPost((current) => ({
        ...current,
        [post.id]: (current[post.id] || []).filter((entry) => entry.responderId !== response.responderId)
      }));
    } catch (error: any) {
      onStatus({ tone: 'error', message: error?.message || 'Unable to dismiss the response.' });
    } finally {
      setBusyKey('');
    }
  };

  if (loading && !posts.length) {
    return (
      <div className="app-card flex items-center justify-center gap-2 p-6 text-sm font-bold text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading your posts...
      </div>
    );
  }

  if (!posts.length) {
    return (
      <div className="app-card p-6 text-center">
        <Megaphone className="mx-auto h-8 w-8 text-gray-300" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-900">You have no opportunity posts yet</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Create a post above and responses will show up here.</div>
      </div>
    );
  }

  return (
    <section className="space-y-3" aria-label="My opportunity posts">
      {posts.map((post) => {
        const responses = responsesByPost[post.id];
        return (
          <article key={post.id} className="app-card overflow-hidden">
            <div className="p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-gray-700">{getMatchingKindLabel(post.kind)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] ${post.status === 'open' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>{post.status}</span>
                {post.expiresAt ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">Expires {post.expiresAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span> : null}
              </div>
              <h3 className="mt-2 text-base font-black leading-5 text-gray-950">{post.title}</h3>
              <p className="mt-1 text-sm font-semibold leading-5 text-gray-600">{buildMatchingSummary(post.matching)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50 p-3">
              {post.status === 'open' ? (
                <>
                  <button type="button" className="ghost-button !min-h-9 !px-3 text-xs" disabled={busyKey === `${post.id}:filled`} onClick={() => runStatusChange(post, 'filled')}>
                    {busyKey === `${post.id}:filled` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                    Mark filled
                  </button>
                  <button type="button" className="ghost-button !min-h-9 !px-3 text-xs" disabled={busyKey === `${post.id}:closed`} onClick={() => runStatusChange(post, 'closed')}>
                    Close
                  </button>
                </>
              ) : (
                <button type="button" className="ghost-button !min-h-9 !px-3 text-xs" disabled={busyKey === `${post.id}:open`} onClick={() => runStatusChange(post, 'open')}>
                  Reopen
                </button>
              )}
              <button type="button" className="ghost-button !min-h-9 !px-3 text-xs" disabled={busyKey === `${post.id}:responses`} onClick={() => void loadResponses(post)}>
                {busyKey === `${post.id}:responses` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageCircle className="h-4 w-4" aria-hidden="true" />}
                {responses ? `Responses (${responses.length})` : 'View responses'}
              </button>
            </div>
            {responses ? (
              <div className="space-y-2 border-t border-gray-100 p-3" data-responses-for={post.id}>
                {responses.length ? responses.map((response) => (
                  <div key={response.responderId} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black text-gray-950">
                        {response.responderName}
                        {response.teamName ? <span className="font-bold text-gray-500"> · {response.teamName}</span> : null}
                      </div>
                      <p className="mt-1 text-sm font-semibold leading-5 text-gray-700">{response.message}</p>
                    </div>
                    <button
                      type="button"
                      className="ghost-button !h-8 !min-h-8 !w-8 flex-none !p-0"
                      aria-label={`Dismiss response from ${response.responderName}`}
                      disabled={busyKey === `${post.id}:${response.responderId}`}
                      onClick={() => void dismissResponse(post, response)}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )) : (
                  <div className="rounded-xl border border-dashed border-gray-200 p-3 text-center text-xs font-semibold text-gray-500">No responses yet.</div>
                )}
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

function OpportunityComposerModal({
  kind,
  home,
  onClose,
  onSubmit
}: {
  kind: MatchingPostKind;
  home: ParentHomeModel | null;
  onClose: () => void;
  onSubmit: (draft: Parameters<typeof createMatchingPost>[1]) => Promise<void>;
}) {
  const isPlayerPost = kind === 'player_seeking_team';
  const players: ParentHomePlayer[] = home?.players || [];
  const adminTeams: ParentHomeTeam[] = (home?.teams || []).filter((team) => isLikelyTeamAdminRole(team.role));
  const [playerKey, setPlayerKey] = useState('');
  const [playerFirstName, setPlayerFirstName] = useState('');
  const [teamId, setTeamId] = useState(adminTeams[0]?.teamId || '');
  const [sport, setSport] = useState(adminTeams[0]?.sport || '');
  const [ageGroup, setAgeGroup] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [zip, setZip] = useState('');
  const [positions, setPositions] = useState('');
  const [level, setLevel] = useState('');
  const [timeframe, setTimeframe] = useState('');
  const [openSpots, setOpenSpots] = useState('');
  const [signupUrl, setSignupUrl] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');

  const selectedTeam = adminTeams.find((team) => team.teamId === teamId) || null;

  const selectLinkedPlayer = (nextKey: string) => {
    setPlayerKey(nextKey);
    const player = players.find((entry) => `${entry.teamId}::${entry.playerId}` === nextKey);
    if (player) {
      // Only the first name is copied into the community post (requirement 1.3.3).
      setPlayerFirstName(player.playerName.split(/\s+/)[0] || '');
      const playerTeam = (home?.teams || []).find((team) => team.teamId === player.teamId);
      if (playerTeam?.sport) setSport(playerTeam.sport);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError('');
    setSubmitting(true);
    try {
      await onSubmit({
        kind,
        sport,
        ageGroup,
        city,
        state: stateCode,
        zip,
        positions,
        level,
        timeframe,
        openSpots: openSpots || null,
        playerFirstName,
        signupUrl,
        description,
        teamId: isPlayerPost ? null : selectedTeam?.teamId || teamId || null,
        teamName: isPlayerPost ? null : selectedTeam?.teamName || null
      });
    } catch (error: any) {
      setLocalError(error?.message || 'Unable to create the post.');
      setSubmitting(false);
    }
  };

  return (
    <Modal overlayClassName="z-[70] flex items-end justify-center bg-gray-950/45 p-3 sm:items-center" ariaLabel={getMatchingKindLabel(kind)} onClose={onClose}>
      <form className="app-card w-full max-w-xl overflow-hidden" onSubmit={handleSubmit}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div>
            <div className="app-label">Opportunities</div>
            <h2 className="mt-1 app-section-title">{getMatchingKindLabel(kind)}</h2>
          </div>
          <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !p-0" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="max-h-[72dvh] space-y-4 overflow-y-auto p-4">
          {localError ? <StatusBanner tone="error" message={localError} /> : null}

          <div className="flex items-start gap-2 rounded-xl border border-primary-100 bg-primary-50 p-3 text-xs font-semibold leading-5 text-primary-900">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
            {isPlayerPost
              ? 'This post is visible to all ALL PLAYS users and is attributed to you. Use a first name only, and do not include contact details — interested coaches respond in the app.'
              : 'This post is visible to all ALL PLAYS users. Do not include contact details — interested families respond in the app or use your team signup link.'}
          </div>

          {isPlayerPost ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {players.length ? (
                <label className="block sm:col-span-2">
                  <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Prefill from a linked player (optional)</span>
                  <select
                    value={playerKey}
                    onChange={(event) => selectLinkedPlayer(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                  >
                    <option value="">Enter details manually</option>
                    {players.map((player) => (
                      <option key={`${player.teamId}-${player.playerId}`} value={`${player.teamId}::${player.playerId}`}>{player.playerName}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Player first name</span>
                <input type="text" value={playerFirstName} onChange={(event) => setPlayerFirstName(event.target.value)} placeholder="First name only" className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Positions (optional)</span>
                <input type="text" value={positions} onChange={(event) => setPositions(event.target.value)} placeholder="e.g. Goalkeeper, midfield" className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
              </label>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Team</span>
                <select
                  value={teamId}
                  onChange={(event) => {
                    setTeamId(event.target.value);
                    const nextTeam = adminTeams.find((team) => team.teamId === event.target.value);
                    if (nextTeam?.sport) setSport(nextTeam.sport);
                  }}
                  className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                >
                  {adminTeams.length ? adminTeams.map((team) => <option key={team.teamId} value={team.teamId}>{team.teamName}</option>) : <option value="">No teams you manage</option>}
                </select>
                {!adminTeams.length ? <span className="mt-1 block text-xs font-semibold text-rose-700">Only team owners and admins can post for a team.</span> : null}
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Open spots (optional)</span>
                <input type="number" min={1} max={99} value={openSpots} onChange={(event) => setOpenSpots(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Positions needed (optional)</span>
                <input type="text" value={positions} onChange={(event) => setPositions(event.target.value)} placeholder="e.g. Pitcher, catcher" className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Signup link (optional)</span>
                <input type="url" value={signupUrl} onChange={(event) => setSignupUrl(event.target.value)} placeholder="https://allplays.ai/..." className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
              </label>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Sport</span>
              <input type="text" value={sport} onChange={(event) => setSport(event.target.value)} placeholder="e.g. Soccer" className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Age group</span>
              <select value={ageGroup} onChange={(event) => setAgeGroup(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100">
                <option value="">Choose age group</option>
                {matchingAgeGroups.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">City</span>
              <input type="text" value={city} onChange={(event) => setCity(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">State</span>
                <input type="text" value={stateCode} onChange={(event) => setStateCode(event.target.value)} maxLength={2} placeholder="OH" className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold uppercase outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">ZIP</span>
                <input type="text" value={zip} onChange={(event) => setZip(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Level (optional)</span>
              <select value={level} onChange={(event) => setLevel(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100">
                <option value="">Any level</option>
                {matchingLevels.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Timeframe (optional)</span>
              <input type="text" value={timeframe} onChange={(event) => setTimeframe(event.target.value)} placeholder="e.g. Spring 2027 season" className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Description (optional)</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={MATCHING_DESCRIPTION_MAX_LENGTH}
              placeholder="Experience, availability, what you're looking for — no contact details."
              className="mt-1 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-base font-semibold leading-6 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </label>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
          <button type="button" className="ghost-button !min-h-10 !px-3 text-sm" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="primary-button !min-h-10 !px-4 text-sm" disabled={submitting || (!isPlayerPost && !adminTeams.length)}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            Post
          </button>
        </div>
      </form>
    </Modal>
  );
}

function OpportunityRespondModal({
  post,
  home,
  onClose,
  onSubmit
}: {
  post: MatchingPost;
  home: ParentHomeModel | null;
  onClose: () => void;
  onSubmit: (input: { message: string; teamId?: string | null; teamName?: string | null }) => Promise<void>;
}) {
  const adminTeams: ParentHomeTeam[] = (home?.teams || []).filter((team) => isLikelyTeamAdminRole(team.role));
  const showTeamPicker = post.kind === 'player_seeking_team' && adminTeams.length > 0;
  const [message, setMessage] = useState('');
  const [teamId, setTeamId] = useState(adminTeams[0]?.teamId || '');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError('');
    setSubmitting(true);
    try {
      const team = adminTeams.find((entry) => entry.teamId === teamId) || null;
      await onSubmit({
        message,
        teamId: showTeamPicker ? team?.teamId || null : null,
        teamName: showTeamPicker ? team?.teamName || null : null
      });
    } catch (error: any) {
      setLocalError(error?.message || 'Unable to send the response.');
      setSubmitting(false);
    }
  };

  return (
    <Modal overlayClassName="z-[70] flex items-end justify-center bg-gray-950/45 p-3 sm:items-center" ariaLabel="Respond to opportunity" onClose={onClose}>
      <form className="app-card w-full max-w-lg overflow-hidden" onSubmit={handleSubmit}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <div className="app-label">Respond</div>
            <h2 className="mt-1 truncate app-section-title">{post.title}</h2>
          </div>
          <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !p-0" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="space-y-4 p-4">
          {localError ? <StatusBanner tone="error" message={localError} /> : null}
          {showTeamPicker ? (
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Responding for team</span>
              <select value={teamId} onChange={(event) => setTeamId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100">
                {adminTeams.map((team) => <option key={team.teamId} value={team.teamId}>{team.teamName}</option>)}
              </select>
            </label>
          ) : null}
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Message</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              maxLength={MATCHING_RESPONSE_MAX_LENGTH}
              placeholder="Introduce yourself — no emails or phone numbers."
              className="mt-1 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-base font-semibold leading-6 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </label>
          <p className="text-xs font-semibold leading-5 text-gray-500">The poster sees your name and message in the app. Contact details are not shared.</p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
          <button type="button" className="ghost-button !min-h-10 !px-3 text-sm" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="primary-button !min-h-10 !px-4 text-sm" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageCircle className="h-4 w-4" aria-hidden="true" />}
            Send response
          </button>
        </div>
      </form>
    </Modal>
  );
}

function StatusBanner({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const isError = tone === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`} role={isError ? 'alert' : 'status'}>
      {isError ? <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />}
      {message}
    </div>
  );
}
