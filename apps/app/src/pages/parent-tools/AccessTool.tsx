import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, RefreshCw, Shield, Users } from 'lucide-react';
import { redeemSignedInInvite } from '../../lib/inviteRedemption';
import { toAppServiceError, type AppServiceError } from '../../lib/appErrors';
import {
    loadParentAccessModel,
    loadParentAccessPlayers,
    loadParentAccessTeams,
    submitParentAccessRequest,
    type ParentAccessPlayer,
    type ParentAccessRequest,
    type ParentAccessTeam
} from '../../lib/parentToolsAccessService';
import { useAsyncOperation } from '../../lib/useAsyncOperation';
import type { AuthState } from '../../lib/types';
import { EmptyState, LoadingBlock, RetryableStatus, Status, ToolHeader, getParentToolErrorMessage } from './shared';

export function AccessTool({ auth, onAccessChanged }: { auth: AuthState; onAccessChanged: () => void }) {
    const [teams, setTeams] = useState<ParentAccessTeam[]>([]);
    const [requests, setRequests] = useState<ParentAccessRequest[]>([]);
    const [players, setPlayers] = useState<ParentAccessPlayer[]>([]);
    const [manualRequestOpen, setManualRequestOpen] = useState(false);
    const [selectedTeamId, setSelectedTeamId] = useState('');
    const [selectedPlayerId, setSelectedPlayerId] = useState('');
    const [relation, setRelation] = useState('Parent');
    const [redeemCode, setRedeemCode] = useState('');
    const [message, setMessage] = useState('');
    const [loadError, setLoadError] = useState<AppServiceError | null>(null);
    const [manualLookupError, setManualLookupError] = useState<AppServiceError | null>(null);
    const [actionError, setActionError] = useState<AppServiceError | null>(null);
    const accessLoadOperation = useAsyncOperation();
    const teamLoadOperation = useAsyncOperation();
    const playerLoadOperation = useAsyncOperation();
    const submitOperation = useAsyncOperation();
    const redeemOperation = useAsyncOperation();
    const runAccessLoad = accessLoadOperation.run;
    const runTeamLoad = teamLoadOperation.run;
    const runPlayerLoad = playerLoadOperation.run;
    const runSubmit = submitOperation.run;
    const runRedeem = redeemOperation.run;

    const loading = accessLoadOperation.loading;
    const loadingTeams = teamLoadOperation.loading;
    const loadingPlayers = playerLoadOperation.loading;
    const saving = submitOperation.loading;
    const redeeming = redeemOperation.loading;

    const loadTeams = useCallback(async () => {
        setManualLookupError(null);
        setActionError(null);
        return runTeamLoad(
            () => loadParentAccessTeams(),
            {
                rethrow: false,
                getErrorMessage: (error) => getParentToolErrorMessage(toAppServiceError(error, 'Unable to load public teams.'), 'Unable to load public teams.'),
                onSuccess: (rows) => {
                    setTeams(rows);
                    setSelectedTeamId((current) => rows.some((team) => team.id === current) ? current : '');
                },
                onError: (error) => {
                    setManualLookupError(toAppServiceError(error, 'Unable to load public teams.'));
                }
            }
        );
    }, [runTeamLoad]);

    const openManualRequest = useCallback(() => {
        setManualRequestOpen(true);
        if (!teams.length && !loadingTeams) {
            void loadTeams();
        }
    }, [loadTeams, loadingTeams, teams.length]);

    const refresh = useCallback(async () => {
        setLoadError(null);
        setManualLookupError(null);
        setActionError(null);
        setMessage('');
        return runAccessLoad(
            () => loadParentAccessModel(auth.user),
            {
                rethrow: false,
                getErrorMessage: (error) => getParentToolErrorMessage(toAppServiceError(error, 'Unable to load team access.'), 'Unable to load team access.'),
                onSuccess: (model) => {
                    setRequests(model.requests);
                },
                onError: (error) => {
                    setLoadError(toAppServiceError(error, 'Unable to load team access.'));
                }
            }
        );
    }, [auth.user, runAccessLoad]);

    useEffect(() => {
        void refresh();
    }, [auth.user?.uid, refresh]);

    useEffect(() => {
        setManualRequestOpen(false);
        setTeams([]);
        setPlayers([]);
        setSelectedTeamId('');
        setSelectedPlayerId('');
    }, [auth.user?.uid]);

    const loadPlayersForTeam = useCallback(async (teamId: string) => {
        setManualLookupError(null);
        const rows = await runPlayerLoad(
            () => loadParentAccessPlayers(teamId),
            {
                rethrow: false,
                getErrorMessage: (error) => getParentToolErrorMessage(toAppServiceError(error, 'Unable to load players for this team.'), 'Unable to load players for this team.'),
                onError: (error) => {
                    setManualLookupError(toAppServiceError(error, 'Unable to load players for this team.'));
                }
            }
        );
        if (rows) {
            setPlayers(rows);
            setSelectedPlayerId(rows[0]?.id || '');
            return;
        }
    }, [runPlayerLoad]);

    useEffect(() => {
        let cancelled = false;
        async function loadPlayers() {
            setPlayers([]);
            setSelectedPlayerId('');
            if (!selectedTeamId) return;
            const rows = await runPlayerLoad(
                () => loadParentAccessPlayers(selectedTeamId),
                {
                    rethrow: false,
                    getErrorMessage: (error) => getParentToolErrorMessage(toAppServiceError(error, 'Unable to load players for this team.'), 'Unable to load players for this team.'),
                    onError: (error) => {
                        if (!cancelled) {
                            setManualLookupError(toAppServiceError(error, 'Unable to load players for this team.'));
                        }
                    }
                }
            );
            if (!cancelled && rows) {
                setManualLookupError(null);
                setPlayers(rows);
                setSelectedPlayerId(rows[0]?.id || '');
            }
        }
        void loadPlayers();
        return () => {
            cancelled = true;
        };
    }, [runPlayerLoad, selectedTeamId]);

    const redeem = async (event: FormEvent) => {
        event.preventDefault();
        const currentUser = auth.user;
        if (!currentUser?.uid) {
            setActionError(toAppServiceError(new Error('Sign in to redeem an invite code.'), 'Sign in to redeem an invite code.'));
            return;
        }

        setActionError(null);
        setMessage('');
        await runRedeem(
            () => redeemSignedInInvite({
                userId: currentUser.uid,
                code: redeemCode,
                email: currentUser.email,
                refresh: auth.refresh
            }),
            {
                rethrow: false,
                getErrorMessage: (error) => getParentToolErrorMessage(toAppServiceError(error, 'Unable to redeem this invite code.'), 'Unable to redeem this invite code.'),
                onSuccess: async (result) => {
                    await refresh();
                    onAccessChanged();
                    setRedeemCode('');
                    setMessage(result.message);
                },
                onError: (error) => {
                    setActionError(toAppServiceError(error, 'Unable to redeem this invite code.'));
                }
            }
        );
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!selectedTeamId || !selectedPlayerId) {
            setActionError(toAppServiceError(new Error('Choose a team and player first.'), 'Choose a team and player first.'));
            return;
        }
        setActionError(null);
        setMessage('');
        await runSubmit(
            () => submitParentAccessRequest(selectedTeamId, selectedPlayerId, relation),
            {
                rethrow: false,
                getErrorMessage: (error) => getParentToolErrorMessage(toAppServiceError(error, 'Unable to send access request.'), 'Unable to send access request.'),
                onSuccess: async () => {
                    await refresh();
                    onAccessChanged();
                    setMessage('Access request sent.');
                },
                onError: (error) => {
                    setActionError(toAppServiceError(error, 'Unable to send access request.'));
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
                                <button type="submit" className="primary-button sm:min-w-[10rem]" disabled={redeeming || saving}>
                                    {redeeming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
                                    {redeeming ? 'Redeeming...' : 'Redeem code'}
                                </button>
                            </div>
                            <p className="mt-2 text-xs font-semibold text-gray-600">Already have an 8-character player invite? Redeem it here and stay in Parent Tools.</p>
                        </form>
                        {manualRequestOpen ? (
                            <form className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_auto]" onSubmit={submit}>
                                {manualLookupError ? <div className="lg:col-span-3"><RetryableStatus error={manualLookupError} fallbackMessage="Unable to load public teams." onRetry={selectedTeamId ? () => { void loadPlayersForTeam(selectedTeamId); } : loadTeams} retrying={loadingTeams || loadingPlayers} /></div> : null}
                                <div className="min-w-0">
                                    <label className="app-label" htmlFor="parent-access-team">Team</label>
                                    <select id="parent-access-team" aria-label="Team" className="auth-input mt-1" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)} disabled={loadingTeams || !teams.length}>
                                        <option value="">{loadingTeams ? 'Loading public teams...' : teams.length ? 'Choose a team' : 'No public teams'}</option>
                                        {teams.map((team) => (
                                            <option key={team.id} value={team.id}>{team.name}{team.sport ? ` - ${team.sport}` : ''}</option>
                                        ))}
                                    </select>
                                    {!loadingTeams && !teams.length ? (
                                        <button type="button" className="ghost-button mt-2 !min-h-9 text-xs" onClick={loadTeams} disabled={redeeming || saving}>
                                            Retry loading public teams
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
