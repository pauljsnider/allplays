import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, RefreshCw, Search, Shield, Users } from 'lucide-react';
import { redeemSignedInInvite } from '../../lib/inviteRedemption';
import { toAppServiceError, type AppServiceError } from '../../lib/appErrors';
import {
    loadParentAccessModel,
    loadParentAccessTeam,
    loadParentAccessPlayers,
    discoverParentAccessTeams,
    submitParentAccessRequest,
    type ParentAccessPlayer,
    type ParentAccessRequest,
    type ParentAccessTeam
} from '../../lib/parentToolsAccessService';
import type { AuthState } from '../../lib/types';
import { EmptyState, LoadingBlock, RetryableStatus, Status, ToolHeader, getParentToolErrorMessage, useParentToolAsyncOperation } from './shared';

export function AccessTool({ auth, onAccessChanged }: { auth: AuthState; onAccessChanged: () => void }) {
    const [searchParams] = useSearchParams();
    const deepLinkedTeamId = searchParams.get('teamId')?.trim() || '';
    const [teams, setTeams] = useState<ParentAccessTeam[]>([]);
    const [teamSearchText, setTeamSearchText] = useState('');
    const [teamNextCursor, setTeamNextCursor] = useState<unknown | null>(null);
    const [teamDiscoveryStarted, setTeamDiscoveryStarted] = useState(false);
    const [requests, setRequests] = useState<ParentAccessRequest[]>([]);
    const [players, setPlayers] = useState<ParentAccessPlayer[]>([]);
    const [manualRequestOpen, setManualRequestOpen] = useState(false);
    const [selectedTeamId, setSelectedTeamId] = useState('');
    const [selectedPlayerId, setSelectedPlayerId] = useState('');
    const [relation, setRelation] = useState('Parent');
    // Tracks the deep link we last reconciled so a NEW deep link (a different
    // teamId opened while already mounted) is applied, while team-list refreshes
    // for the same deep link don't clobber a later manual selection.
    const appliedDeepLinkRef = useRef('');
    const initialDeepLinkDiscoveryAttemptRef = useRef('');
    const initialDeepLinkDiscoveryCompleteRef = useRef('');
    const deepLinkLookupAttemptRef = useRef('');
    const deepLinkIntentRef = useRef(deepLinkedTeamId);
    const teamSearchRequestRef = useRef(0);
    const playerLoadRequestRef = useRef(0);
    const [deepLinkReconcileVersion, setDeepLinkReconcileVersion] = useState(0);
    const [redeemCode, setRedeemCode] = useState('');
    const [message, setMessage] = useState('');
    const accessLoadOperation = useParentToolAsyncOperation();
    const teamLoadOperation = useParentToolAsyncOperation();
    const playerLoadOperation = useParentToolAsyncOperation();
    const submitOperation = useParentToolAsyncOperation();
    const redeemOperation = useParentToolAsyncOperation();
    const runAccessLoad = accessLoadOperation.run;
    const runTeamLoad = teamLoadOperation.run;
    const runPlayerLoad = playerLoadOperation.run;
    const runSubmit = submitOperation.run;
    const runRedeem = redeemOperation.run;
    const clearAccessLoadError = accessLoadOperation.clearError;
    const clearTeamLoadError = teamLoadOperation.clearError;
    const clearPlayerLoadError = playerLoadOperation.clearError;
    const invalidateTeamLoad = teamLoadOperation.invalidate;
    const invalidatePlayerLoad = playerLoadOperation.invalidate;
    const clearSubmitError = submitOperation.clearError;
    const clearRedeemError = redeemOperation.clearError;
    const setSubmitError = submitOperation.setError;
    const setRedeemError = redeemOperation.setError;

    const loading = accessLoadOperation.loading;
    const loadingTeams = teamLoadOperation.loading;
    const loadingPlayers = playerLoadOperation.loading;
    const saving = submitOperation.loading;
    const redeeming = redeemOperation.loading;
    const { error: loadError } = accessLoadOperation;
    const { error: teamLoadError } = teamLoadOperation;
    const { error: playerLoadError } = playerLoadOperation;
    const { error: submitError } = submitOperation;
    const { error: redeemError } = redeemOperation;
    const manualLookupError = teamLoadError ?? playerLoadError;
    const actionError = submitError ?? redeemError;
    const normalizedRedeemCode = redeemCode.trim().toUpperCase();
    const redeemCodeReady = normalizedRedeemCode.length === 8;

    const loadTeams = useCallback(async ({ cursor = null, append = false, searchText = teamSearchText }: { cursor?: unknown | null; append?: boolean; searchText?: string } = {}) => {
        const requestId = teamSearchRequestRef.current + 1;
        teamSearchRequestRef.current = requestId;
        const normalizedSearchText = String(searchText || '').trim();
        clearTeamLoadError();
        clearPlayerLoadError();
        clearSubmitError();
        clearRedeemError();
        setTeamDiscoveryStarted(true);
        return runTeamLoad(
            () => discoverParentAccessTeams({ searchText: normalizedSearchText, cursor, pageSize: 20 }),
            'Unable to load public teams.',
            {
                ignoreStale: true,
                onSuccess: (page) => {
                    if (requestId !== teamSearchRequestRef.current) return;
                    setTeamNextCursor(page.nextCursor);
                    setTeams((currentRows) => {
                        const nextRows = append ? [...currentRows, ...page.teams] : page.teams;
                        const seen = new Set<string>();
                        return nextRows.filter((team) => {
                            if (seen.has(team.id)) return false;
                            seen.add(team.id);
                            return true;
                        });
                    });
                    setSelectedTeamId((current) => {
                        if (append) return current;
                        return page.teams.some((team) => team.id === current) ? current : '';
                    });
                }
            }
        );
    }, [clearPlayerLoadError, clearRedeemError, clearSubmitError, clearTeamLoadError, runTeamLoad, teamSearchText]);

    const loadDeepLinkedTeam = useCallback(async (teamId: string) => {
        const requestId = teamSearchRequestRef.current + 1;
        teamSearchRequestRef.current = requestId;
        clearTeamLoadError();
        clearPlayerLoadError();
        clearSubmitError();
        clearRedeemError();
        setTeamDiscoveryStarted(true);
        return runTeamLoad(
            () => loadParentAccessTeam(teamId),
            'Unable to load public teams.',
            {
                ignoreStale: true,
                onSuccess: (team) => {
                    if (requestId !== teamSearchRequestRef.current) return;
                    appliedDeepLinkRef.current = teamId;
                    setManualRequestOpen(true);
                    if (!team) {
                        setSelectedTeamId('');
                        return;
                    }
                    setTeams((currentRows) => {
                        if (currentRows.some((row) => row.id === team.id)) return currentRows;
                        return [...currentRows, team];
                    });
                    setSelectedTeamId(teamId);
                }
            }
        );
    }, [clearPlayerLoadError, clearRedeemError, clearSubmitError, clearTeamLoadError, runTeamLoad]);

    const openManualRequest = useCallback(() => {
        setManualRequestOpen(true);
    }, []);

    const searchTeams = useCallback(async (event?: FormEvent) => {
        event?.preventDefault();
        setSelectedTeamId('');
        setSelectedPlayerId('');
        setPlayers([]);
        await loadTeams({ searchText: teamSearchText, cursor: null, append: false });
    }, [loadTeams, teamSearchText]);

    const browseTeams = useCallback(async () => {
        setTeamSearchText('');
        setSelectedTeamId('');
        setSelectedPlayerId('');
        setPlayers([]);
        await loadTeams({ searchText: '', cursor: null, append: false });
    }, [loadTeams]);

    const loadMoreTeams = useCallback(async () => {
        if (!teamNextCursor) return;
        await loadTeams({ searchText: teamSearchText, cursor: teamNextCursor, append: true });
    }, [loadTeams, teamNextCursor, teamSearchText]);

    const refresh = useCallback(async () => {
        clearAccessLoadError();
        clearTeamLoadError();
        clearPlayerLoadError();
        clearSubmitError();
        clearRedeemError();
        setMessage('');
        return runAccessLoad(
            () => loadParentAccessModel(auth.user),
            'Unable to load team access.',
            {
                onSuccess: (model) => {
                    setRequests(model.requests);
                }
            }
        );
    }, [auth.user, clearAccessLoadError, clearPlayerLoadError, clearRedeemError, clearSubmitError, clearTeamLoadError, runAccessLoad]);

    useEffect(() => {
        void refresh();
    }, [auth.user?.uid, refresh]);

    useEffect(() => {
        teamSearchRequestRef.current += 1;
        playerLoadRequestRef.current += 1;
        invalidateTeamLoad();
        invalidatePlayerLoad();
        appliedDeepLinkRef.current = '';
        initialDeepLinkDiscoveryAttemptRef.current = '';
        initialDeepLinkDiscoveryCompleteRef.current = '';
        deepLinkLookupAttemptRef.current = '';
        setManualRequestOpen(false);
        setTeams([]);
        setTeamSearchText('');
        setTeamNextCursor(null);
        setTeamDiscoveryStarted(false);
        setPlayers([]);
        setSelectedTeamId('');
        setSelectedPlayerId('');
    }, [auth.user?.uid, invalidatePlayerLoad, invalidateTeamLoad]);

    useEffect(() => {
        if (!deepLinkedTeamId) return;
        setManualRequestOpen(true);
        setTeamDiscoveryStarted(true);
    }, [deepLinkedTeamId]);

    useEffect(() => {
        if (!deepLinkedTeamId || teams.length || loadingTeams) return;
        if (initialDeepLinkDiscoveryAttemptRef.current === deepLinkedTeamId) return;
        initialDeepLinkDiscoveryAttemptRef.current = deepLinkedTeamId;
        void loadTeams({ searchText: '', cursor: null, append: false }).finally(() => {
            if (initialDeepLinkDiscoveryAttemptRef.current !== deepLinkedTeamId) return;
            initialDeepLinkDiscoveryCompleteRef.current = deepLinkedTeamId;
            setDeepLinkReconcileVersion((current) => current + 1);
        });
    }, [deepLinkedTeamId, deepLinkReconcileVersion, loadTeams, loadingTeams, teams.length]);

    useEffect(() => {
        if (deepLinkIntentRef.current !== deepLinkedTeamId) {
            deepLinkIntentRef.current = deepLinkedTeamId;
            teamSearchRequestRef.current += 1;
            invalidateTeamLoad();
        }
        if (deepLinkedTeamId) return;
        appliedDeepLinkRef.current = '';
        initialDeepLinkDiscoveryAttemptRef.current = '';
        initialDeepLinkDiscoveryCompleteRef.current = '';
        deepLinkLookupAttemptRef.current = '';
    }, [deepLinkedTeamId, invalidateTeamLoad]);

    useEffect(() => {
        // Wait until teams have loaded so we can tell whether the deep-linked team
        // is accessible before reconciling the selection.
        if (!deepLinkedTeamId || appliedDeepLinkRef.current === deepLinkedTeamId) return;
        if (loadingTeams) return;
        setManualRequestOpen(true);
        if (teams.some((team) => team.id === deepLinkedTeamId)) {
            // A new deep link is an explicit navigation intent: switch to it even
            // if a previous team was already selected.
            appliedDeepLinkRef.current = deepLinkedTeamId;
            setSelectedTeamId(deepLinkedTeamId);
        } else {
            if (!teams.length && initialDeepLinkDiscoveryCompleteRef.current !== deepLinkedTeamId) return;
            if (deepLinkLookupAttemptRef.current === deepLinkedTeamId) return;
            deepLinkLookupAttemptRef.current = deepLinkedTeamId;
            // A new deep link replaces the prior selection intent. Clear the old
            // roster before looking up the target so a failed lookup cannot leave
            // submission enabled for the previous team.
            setSelectedTeamId('');
            setSelectedPlayerId('');
            setPlayers([]);
            void loadDeepLinkedTeam(deepLinkedTeamId);
        }
    }, [deepLinkedTeamId, deepLinkReconcileVersion, teams, loadingTeams, loadDeepLinkedTeam]);

    const loadPlayersForTeam = useCallback(async (teamId: string) => {
        const requestId = playerLoadRequestRef.current + 1;
        playerLoadRequestRef.current = requestId;
        invalidatePlayerLoad();
        setPlayers([]);
        setSelectedPlayerId('');
        if (!teamId) {
            clearPlayerLoadError();
            return;
        }
        await runPlayerLoad(
            () => loadParentAccessPlayers(teamId),
            'Unable to load players for this team.',
            {
                ignoreStale: true,
                onSuccess: (result) => {
                    if (requestId !== playerLoadRequestRef.current) return;
                    setPlayers(result);
                    setSelectedPlayerId(result[0]?.id || '');
                }
            }
        );
    }, [clearPlayerLoadError, invalidatePlayerLoad, runPlayerLoad]);

    const retryManualLookup = () => {
        if (playerLoadError && selectedTeamId) {
            void loadPlayersForTeam(selectedTeamId);
            return;
        }
        if (deepLinkedTeamId) {
            appliedDeepLinkRef.current = '';
            initialDeepLinkDiscoveryAttemptRef.current = '';
            initialDeepLinkDiscoveryCompleteRef.current = '';
            deepLinkLookupAttemptRef.current = '';
            setDeepLinkReconcileVersion((current) => current + 1);
            return;
        }
        void loadTeams({ searchText: teamSearchText, cursor: null, append: false });
    };

    useEffect(() => {
        void loadPlayersForTeam(selectedTeamId);
        return () => {
            playerLoadRequestRef.current += 1;
        };
    }, [loadPlayersForTeam, selectedTeamId]);

    const redeem = async (event: FormEvent) => {
        event.preventDefault();
        if (!redeemCodeReady) return;
        const currentUser = auth.user;
        if (!currentUser?.uid) {
            setRedeemError(toAppServiceError(new Error('Sign in to redeem an invite code.'), 'Sign in to redeem an invite code.'));
            return;
        }

        clearSubmitError();
        clearRedeemError();
        setMessage('');
        await runRedeem(
            () => redeemSignedInInvite({
                userId: currentUser.uid,
                code: normalizedRedeemCode,
                email: currentUser.email,
                refresh: auth.refresh
            }),
            'Unable to redeem this invite code.',
            {
                onSuccess: async (result) => {
                    await refresh();
                    onAccessChanged();
                    setRedeemCode('');
                    setMessage(result.message);
                }
            }
        );
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!selectedTeamId || !selectedPlayerId) {
            setSubmitError(toAppServiceError(new Error('Choose a team and player first.'), 'Choose a team and player first.'));
            return;
        }
        clearSubmitError();
        clearRedeemError();
        setMessage('');
        await runSubmit(
            () => submitParentAccessRequest(selectedTeamId, selectedPlayerId, relation),
            'Unable to send access request.',
            {
                onSuccess: async () => {
                    await refresh();
                    onAccessChanged();
                    setMessage('Access request sent.');
                }
            }
        );
    };

    return (
        <div className="space-y-3">
            <section className="app-card p-4">
                <ToolHeader icon={Shield} title="Request player access" detail="Use this when you do not have an invite code." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading || redeeming}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
                {loadError ? <RetryableStatus error={loadError} fallbackMessage="Unable to load team access." onRetry={refresh} retrying={loading} /> : null}
                {actionError ? <Status tone="error" message={getParentToolErrorMessage(actionError, 'Unable to complete that action.')} /> : null}
                {message ? <Status tone="success" message={message} /> : null}
                {loading ? <LoadingBlock label="Loading access tools" /> : (
                    <>
                        <form className="mt-3 rounded-2xl border border-primary-100 bg-primary-50/60 p-3" onSubmit={redeem}>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                                <label className="min-w-0 flex-1">
                                    <span className="app-label">Invite code</span>
                                    <input
                                        className="auth-input mt-1 text-center font-mono uppercase tracking-[0.3em]"
                                        value={redeemCode}
                                        onChange={(event) => setRedeemCode(event.target.value.toUpperCase())}
                                        maxLength={8}
                                        placeholder="XXXXXXXX"
                                        inputMode="text"
                                        autoCapitalize="characters"
                                        autoComplete="one-time-code"
                                        enterKeyHint="go"
                                        disabled={redeeming || saving}
                                    />
                                </label>
                                <button type="submit" className="primary-button sm:min-w-[10rem]" disabled={redeeming || saving || !redeemCodeReady}>
                                    {redeeming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
                                    {redeeming ? 'Redeeming...' : 'Redeem code'}
                                </button>
                            </div>
                            <p className="mt-2 text-xs font-semibold text-gray-600">Already have an 8-character player invite? Redeem it here and stay in Parent Tools.</p>
                        </form>
                        {manualRequestOpen ? (
                            <form className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_auto]" onSubmit={submit}>
                                {manualLookupError ? <div className="lg:col-span-3"><RetryableStatus error={manualLookupError} fallbackMessage="Unable to load public teams." onRetry={retryManualLookup} retrying={loadingTeams || loadingPlayers} /></div> : null}
                                <div className="min-w-0 lg:col-span-3">
                                    <label className="app-label" htmlFor="parent-access-team-search">Search public teams</label>
                                    <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                                        <input
                                            id="parent-access-team-search"
                                            className="auth-input min-w-0 flex-1"
                                            value={teamSearchText}
                                            onChange={(event) => {
                                                teamSearchRequestRef.current += 1;
                                                invalidateTeamLoad();
                                                setTeamSearchText(event.target.value);
                                                setSelectedTeamId('');
                                                setSelectedPlayerId('');
                                                setPlayers([]);
                                                setTeams([]);
                                                setTeamNextCursor(null);
                                                setTeamDiscoveryStarted(false);
                                            }}
                                            onKeyDown={(event) => {
                                                if (event.key !== 'Enter') return;
                                                event.preventDefault();
                                                void searchTeams();
                                            }}
                                            placeholder="Team name, city, state, or zip"
                                            disabled={saving || redeeming}
                                        />
                                        <button type="button" className="secondary-button sm:min-w-[8rem]" onClick={() => { void searchTeams(); }} disabled={saving || redeeming}>
                                            {loadingTeams ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
                                            Search
                                        </button>
                                        <button type="button" className="ghost-button !min-h-10 text-xs sm:min-w-[7rem]" onClick={browseTeams} disabled={saving || redeeming}>
                                            Browse
                                        </button>
                                    </div>
                                </div>
                                <div className="min-w-0">
                                    <label className="app-label" htmlFor="parent-access-team">Team</label>
                                    <select id="parent-access-team" aria-label="Team" className="auth-input mt-1" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)} disabled={loadingTeams || !teams.length}>
                                        <option value="">{loadingTeams ? 'Loading public teams...' : teams.length ? 'Choose a team' : teamDiscoveryStarted ? 'No public teams found' : 'Search or browse teams'}</option>
                                        {teams.map((team) => (
                                            <option key={team.id} value={team.id}>{formatTeamOption(team)}</option>
                                        ))}
                                    </select>
                                    {teamNextCursor ? (
                                        <button type="button" className="ghost-button mt-2 !min-h-9 text-xs" onClick={loadMoreTeams} disabled={loadingTeams || redeeming || saving}>
                                            {loadingTeams ? 'Loading...' : 'Load more teams'}
                                        </button>
                                    ) : null}
                                </div>
                                <div className="min-w-0">
                                    <label className="app-label" htmlFor="parent-access-player">Player</label>
                                    <select id="parent-access-player" aria-label="Player" className="auth-input mt-1" value={selectedPlayerId} onChange={(event) => setSelectedPlayerId(event.target.value)} disabled={!selectedTeamId || loadingPlayers}>
                                        <option value="">{selectedTeamId ? (loadingPlayers ? 'Loading players...' : players.length ? 'Choose a player' : 'No players found') : 'Choose a team first'}</option>
                                        {players.map((player) => (
                                            <option key={player.id} value={player.id}>{player.number ? `#${player.number} ` : ''}{player.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="min-w-0">
                                    <label className="app-label" htmlFor="parent-access-relation">Relationship</label>
                                    <select id="parent-access-relation" aria-label="Relationship" className="auth-input mt-1" value={relation} onChange={(event) => setRelation(event.target.value)}>
                                        <option value="Parent">Parent</option>
                                        <option value="Guardian">Guardian</option>
                                        <option value="Grandparent">Grandparent</option>
                                        <option value="Family">Family</option>
                                    </select>
                                </div>
                                <button type="submit" className="primary-button lg:col-span-3" disabled={saving || redeeming || loadingTeams || loadingPlayers || !selectedTeamId || !selectedPlayerId}>
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Shield className="h-4 w-4" aria-hidden="true" />}
                                    Send request
                                </button>
                            </form>
                        ) : (
                            <div className="mt-3 rounded-2xl border border-dashed border-gray-200 bg-white p-3">
                                <div className="text-sm font-black text-gray-950">Need manual access?</div>
                                <p className="mt-1 text-xs font-semibold text-gray-600">Open the manual request form only when you need to search public teams and request access to a player.</p>
                                <button type="button" className="secondary-button mt-3" onClick={openManualRequest} disabled={redeeming || saving || loadingTeams}>
                                    {loadingTeams ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Shield className="h-4 w-4" aria-hidden="true" />}
                                    {loadingTeams ? 'Loading public teams...' : 'Request access without a code'}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </section>

            <section className="app-card p-4">
                <ToolHeader icon={Users} title="Access requests" detail="Pending and decided requests from your account." action={<Link to="/accept-invite" className="secondary-button !min-h-9 text-xs">Open full invite flow</Link>} />
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {requests.length ? requests.map((request) => <AccessRequestCard key={request.id || `${request.teamId}-${request.playerId}`} request={request} />) : (
                        <EmptyState icon={Shield} title="No requests yet" detail="Invite codes can be redeemed here, or you can open the full invite flow." />
                    )}
                </div>
            </section>
        </div>
    );
}

function formatTeamOption(team: ParentAccessTeam) {
    const details = [team.sport, [team.city, team.state].filter(Boolean).join(', '), team.zip].filter(Boolean);
    return details.length ? `${team.name} - ${details.join(' - ')}` : team.name;
}

function AccessRequestCard({ request }: { request: ParentAccessRequest }) {
    const status = String(request.status || 'pending').toLowerCase();
    const statusClass = status === 'approved'
        ? 'bg-emerald-50 text-emerald-700'
        : status === 'denied' || status === 'rejected'
            ? 'bg-rose-50 text-rose-700'
            : 'bg-amber-50 text-amber-700';
    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-sm font-black text-gray-950">{request.playerName}</div>
                    <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{request.teamName} - {request.relation}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${statusClass}`}>{request.status}</span>
            </div>
            {request.decisionNote ? <div className="mt-2 text-xs font-semibold text-gray-600">{request.decisionNote}</div> : null}
        </div>
    );
}
