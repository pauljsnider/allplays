import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Copy, Loader2, RefreshCw, Users } from 'lucide-react';
import { createParentHouseholdMemberInvite, loadParentHouseholdInviteModel, type ParentHouseholdFamilyMember, type ParentHouseholdLinkedPlayer } from '../../lib/parentToolsService';
import { toAppServiceError } from '../../lib/appErrors';
import type { AuthState } from '../../lib/types';
import { EmptyState, LoadingBlock, RetryableStatus, Status, ToolHeader, copyText, useParentToolAsyncOperation } from './shared';

export function HouseholdInviteTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
    const [linkedPlayers, setLinkedPlayers] = useState<ParentHouseholdLinkedPlayer[]>([]);
    const [members, setMembers] = useState<ParentHouseholdFamilyMember[]>([]);
    const [playerKey, setPlayerKey] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [relation, setRelation] = useState('');
    const [createdInvite, setCreatedInvite] = useState<{ code: string; inviteUrl: string } | null>(null);
    const [message, setMessage] = useState('');
    const loadOperation = useParentToolAsyncOperation();
    const submitOperation = useParentToolAsyncOperation();
    const runLoad = loadOperation.run;
    const runSubmit = submitOperation.run;
    const loading = loadOperation.loading;
    const saving = submitOperation.loading;
    const error = loadOperation.error ?? submitOperation.error;

    const pendingMembers = useMemo(() => members.filter((member) => String(member.status || '').toLowerCase() === 'pending'), [members]);

    const refresh = useCallback(async () => {
        loadOperation.clearError();
        submitOperation.clearError();
        return runLoad(
            () => loadParentHouseholdInviteModel(auth.user),
            'Unable to load household invites.',
            {
                onSuccess: (model) => {
                    setLinkedPlayers(model.linkedPlayers);
                    setMembers(model.members);
                    setPlayerKey((current) => current || (model.linkedPlayers[0] ? `${model.linkedPlayers[0].teamId}::${model.linkedPlayers[0].playerId}` : ''));
                }
            }
        );
    }, [auth.user, loadOperation, runLoad, submitOperation]);

    useEffect(() => {
        void refresh();
    }, [auth.user?.uid, refresh, refreshVersion]);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        const trimmedEmail = email.trim();
        const trimmedRelation = relation.trim();
        if (!playerKey) {
            submitOperation.setError(toAppServiceError(new Error('Choose a linked player first.'), 'Choose a linked player first.'));
            return;
        }
        if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            submitOperation.setError(toAppServiceError(new Error('Enter a valid email for the household contact.'), 'Enter a valid email for the household contact.'));
            return;
        }
        if (!trimmedRelation) {
            submitOperation.setError(toAppServiceError(new Error('Enter the household contact relation.'), 'Enter the household contact relation.'));
            return;
        }
        submitOperation.clearError();
        setMessage('');
        setCreatedInvite(null);
        await runSubmit(
            () => createParentHouseholdMemberInvite(auth.user, {
                playerKey,
                displayName,
                email: trimmedEmail,
                relation: trimmedRelation
            }),
            'Unable to create household invite.',
            {
                onSuccess: async (result) => {
                    setCreatedInvite(result);
                    setMessage('Household invite created.');
                    setDisplayName('');
                    setEmail('');
                    setRelation('');
                    await refresh();
                }
            }
        );
    };

    return (
        <div className="space-y-3">
            <section className="app-card p-4">
                <ToolHeader icon={Users} title="Household member invite" detail="Create one pending family plan invite for a linked player. This is separate from co-parent and token share links." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
                {error ? <RetryableStatus error={error} fallbackMessage="Unable to load household invites." onRetry={loading ? undefined : refresh} retrying={loading} /> : null}
                {message ? <Status tone="success" message={message} /> : null}
                {createdInvite ? (
                    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                        <div className="font-black">Invite code: <span className="font-mono">{createdInvite.code}</span></div>
                        <div className="mt-1 break-all text-xs font-semibold">{createdInvite.inviteUrl}</div>
                        <button type="button" className="ghost-button mt-2 !min-h-8 text-xs" onClick={() => copyText(createdInvite.inviteUrl, setMessage)}><Copy className="h-4 w-4" aria-hidden="true" />Copy invite link</button>
                    </div>
                ) : null}
                {loading ? <LoadingBlock label="Loading household invites" /> : (
                    <form className="mt-3 grid gap-3" onSubmit={submit}>
                        <label>
                            <span className="app-label">Linked player</span>
                            <select className="auth-input mt-1" value={playerKey} onChange={(event) => setPlayerKey(event.target.value)} disabled={!linkedPlayers.length || saving}>
                                {linkedPlayers.length ? linkedPlayers.map((player) => (
                                    <option key={`${player.teamId}-${player.playerId}`} value={`${player.teamId}::${player.playerId}`}>{player.playerName || 'Player'}{player.playerNumber ? ` #${player.playerNumber}` : ''}{player.teamName ? ` - ${player.teamName}` : ''}</option>
                                )) : <option value="">No linked players</option>}
                            </select>
                        </label>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <input className="auth-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Name (optional)" autoComplete="name" enterKeyHint="next" disabled={saving || !linkedPlayers.length} />
                            <input className="auth-input" type="email" inputMode="email" autoComplete="email" enterKeyHint="send" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Household contact email" disabled={saving || !linkedPlayers.length} />
                        </div>
                        <input className="auth-input" value={relation} onChange={(event) => setRelation(event.target.value)} placeholder="Relation, like grandparent or guardian" autoComplete="off" enterKeyHint="next" disabled={saving || !linkedPlayers.length} />
                        <button type="submit" className="primary-button" disabled={saving || loading || !linkedPlayers.length}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Users className="h-4 w-4" aria-hidden="true" />}
                            Create household invite
                        </button>
                    </form>
                )}
            </section>

            <section className="app-card p-4">
                <ToolHeader icon={Users} title="Pending household invites" detail="Family membership invites that have not been redeemed or removed." />
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {pendingMembers.length ? pendingMembers.map((member) => (
                        <div key={member.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                            <div className="text-sm font-black text-gray-950">{member.displayName || member.email}</div>
                            <div className="mt-0.5 text-xs font-semibold text-gray-500">{member.email}</div>
                            <div className="mt-1 text-xs font-semibold text-gray-600">{member.relation || 'Household contact'} for {member.playerName || 'Player'}{member.playerNumber ? ` #${member.playerNumber}` : ''}{member.teamName ? ` - ${member.teamName}` : ''}</div>
                            {member.accessCode ? <div className="mt-2 text-xs font-semibold text-gray-600">Code <span className="font-mono">{member.accessCode}</span></div> : null}
                        </div>
                    )) : <EmptyState icon={Users} title="No pending household invites" detail="Create an invite when a household member needs account-based access to a linked player." />}
                </div>
            </section>
        </div>
    );
}
