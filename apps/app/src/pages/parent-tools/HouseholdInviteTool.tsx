import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, Copy, Loader2, RefreshCw, Users } from 'lucide-react';
import { createParentHouseholdMemberInvite, loadParentHouseholdInviteModel, revokeParentHouseholdMemberAccess, type ParentHouseholdFamilyContact, type ParentHouseholdFamilyMember, type ParentHouseholdLinkedPlayer } from '../../lib/parentHouseholdService';
import { toAppServiceError } from '../../lib/appErrors';
import { PremiumGate } from '../../components/PremiumGate';
import { Modal } from '../../components/Modal';
import { PREMIUM_FEATURES, PREMIUM_SCOPES } from '../../lib/premiumAccessService';
import { usePremiumFeatureAccess } from '../../lib/usePremiumFeatureAccess';
import type { AuthState } from '../../lib/types';
import { copyText, EmptyState, InviteResultCard, LoadingBlock, RetryableStatus, Status, ToolHeader, useParentToolAsyncOperation } from './shared';

export function HouseholdInviteTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
    const premiumAccess = usePremiumFeatureAccess({
        scope: PREMIUM_SCOPES.ACCOUNT,
        feature: PREMIUM_FEATURES.FAMILY_PLAN,
        user: auth.user,
        normalAccess: Boolean(auth.user?.uid)
    });
    const canCreateInvite = premiumAccess.state === 'unlocked';
    const [linkedPlayers, setLinkedPlayers] = useState<ParentHouseholdLinkedPlayer[]>([]);
    const [members, setMembers] = useState<ParentHouseholdFamilyMember[]>([]);
    const [linkedContacts, setLinkedContacts] = useState<ParentHouseholdFamilyContact[]>([]);
    const [playerKey, setPlayerKey] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [relation, setRelation] = useState('');
    const [createdInvite, setCreatedInvite] = useState<{ code: string; inviteUrl: string; email: string; emailSent: boolean } | null>(null);
    const [message, setMessage] = useState('');
    const [copiedEmail, setCopiedEmail] = useState('');
    const [pendingRevokeMember, setPendingRevokeMember] = useState<ParentHouseholdFamilyMember | null>(null);
    const [failedRevokeMember, setFailedRevokeMember] = useState<ParentHouseholdFamilyMember | null>(null);
    const loadOperation = useParentToolAsyncOperation();
    const submitOperation = useParentToolAsyncOperation();
    const revokeOperation = useParentToolAsyncOperation();
    const runLoad = loadOperation.run;
    const runSubmit = submitOperation.run;
    const runRevoke = revokeOperation.run;
    const clearLoadError = loadOperation.clearError;
    const clearSubmitError = submitOperation.clearError;
    const clearRevokeError = revokeOperation.clearError;
    const setSubmitError = submitOperation.setError;
    const loading = loadOperation.loading;
    const saving = submitOperation.loading;
    const revoking = revokeOperation.loading;
    const error = loadOperation.error ?? submitOperation.error;
    const revokeError = revokeOperation.error;

    const activeMembers = useMemo(() => members.filter((member) => String(member.status || '').toLowerCase() === 'active'), [members]);
    const pendingMembers = useMemo(() => members.filter((member) => String(member.status || '').toLowerCase() === 'pending'), [members]);

    const refresh = useCallback(async () => {
        clearLoadError();
        clearSubmitError();
        return runLoad(
            () => loadParentHouseholdInviteModel(auth.user),
            'Unable to load household invites.',
            {
                onSuccess: (model) => {
                    setLinkedPlayers(model.linkedPlayers);
                    setMembers(model.members);
                    setLinkedContacts(model.linkedContacts || []);
                    setPlayerKey((current) => current || (model.linkedPlayers[0] ? `${model.linkedPlayers[0].teamId}::${model.linkedPlayers[0].playerId}` : ''));
                }
            }
        );
    }, [auth.user, clearLoadError, clearSubmitError, runLoad]);

    useEffect(() => {
        void refresh();
    }, [auth.user?.uid, refresh, refreshVersion]);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!canCreateInvite) {
            setSubmitError(toAppServiceError(new Error('Premium access is required to create a household invite.'), 'Premium access is required to create a household invite.'));
            return;
        }
        const trimmedEmail = email.trim();
        const trimmedRelation = relation.trim();
        if (!playerKey) {
            setSubmitError(toAppServiceError(new Error('Choose a linked player first.'), 'Choose a linked player first.'));
            return;
        }
        if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            setSubmitError(toAppServiceError(new Error('Enter a valid email for the household contact.'), 'Enter a valid email for the household contact.'));
            return;
        }
        if (!trimmedRelation) {
            setSubmitError(toAppServiceError(new Error('Enter the household contact relation.'), 'Enter the household contact relation.'));
            return;
        }
        clearSubmitError();
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
                    setMessage('Invite created.');
                    setDisplayName('');
                    setEmail('');
                    setRelation('');
                    await refresh();
                }
            }
        );
    };

    const revoke = async (member: ParentHouseholdFamilyMember) => {
        clearRevokeError();
        setFailedRevokeMember(null);
        setMessage('');
        await runRevoke(
            () => revokeParentHouseholdMemberAccess(auth.user, member.id),
            'Unable to revoke household access.',
            {
                onSuccess: async () => {
                    const refreshed = await refresh();
                    if (refreshed) setMessage('Household access revoked.');
                },
                onError: () => {
                    setFailedRevokeMember(member);
                },
                onFinally: () => {
                    setPendingRevokeMember(null);
                }
            }
        );
    };
    const copyEmail = async (nextEmail: string) => {
        const normalizedEmail = String(nextEmail || '').trim();
        if (!normalizedEmail) return;
        await copyText(normalizedEmail, setMessage);
        setCopiedEmail(normalizedEmail);
        window.setTimeout(() => setCopiedEmail((current) => current === normalizedEmail ? '' : current), 1400);
    };

    return (
        <div className="space-y-3">
            <section className="app-card p-4">
                <ToolHeader icon={Users} title="Create invite" detail="Invite another parent or caregiver to connect their account to one of your linked players." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
                {error ? <RetryableStatus error={error} fallbackMessage="Unable to load household invites." onRetry={loading ? undefined : refresh} retrying={loading} /> : null}
                {revokeError ? <RetryableStatus error={revokeError} fallbackMessage="Unable to revoke household access." onRetry={failedRevokeMember && !revoking ? () => setPendingRevokeMember(failedRevokeMember) : undefined} retrying={revoking} buttonLabel="Try again" /> : null}
                {message ? <Status tone="success" message={message} /> : null}
                {createdInvite ? (
                    <InviteResultCard
                        code={createdInvite.code}
                        inviteUrl={createdInvite.inviteUrl}
                        recipientEmail={createdInvite.email}
                        emailSent={createdInvite.emailSent}
                        title="Invite code"
                        shareTitle="ALL PLAYS parent invite"
                        shareText={`Join ALL PLAYS to follow this player with invite code ${createdInvite.code}.`}
                        onStatus={setMessage}
                    />
                ) : null}
                {!canCreateInvite ? <PremiumGate access={premiumAccess} label="new parent and caregiver invitations"><span /></PremiumGate> : null}
                {loading ? <LoadingBlock label="Loading household invites" /> : (
                    <form className="mt-3 grid gap-3" onSubmit={submit}>
                        <label>
                            <span className="app-label">Linked player</span>
                            <select className="auth-input mt-1" value={playerKey} onChange={(event) => setPlayerKey(event.target.value)} disabled={!linkedPlayers.length || saving || !canCreateInvite}>
                                {linkedPlayers.length ? linkedPlayers.map((player) => (
                                    <option key={`${player.teamId}-${player.playerId}`} value={`${player.teamId}::${player.playerId}`}>{player.playerName || 'Player'}{player.playerNumber ? ` #${player.playerNumber}` : ''}{player.teamName ? ` - ${player.teamName}` : ''}</option>
                                )) : <option value="">No linked players</option>}
                            </select>
                        </label>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <input aria-label="Name" className="auth-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Name (optional)" autoComplete="name" enterKeyHint="next" disabled={saving || !linkedPlayers.length || !canCreateInvite} />
                            <input aria-label="Email" className="auth-input" type="email" inputMode="email" autoComplete="email" enterKeyHint="send" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Recipient email" disabled={saving || !linkedPlayers.length || !canCreateInvite} />
                        </div>
                        <input aria-label="Relation" className="auth-input" value={relation} onChange={(event) => setRelation(event.target.value)} placeholder="Relation, like grandparent or guardian" autoComplete="off" enterKeyHint="next" disabled={saving || !linkedPlayers.length || !canCreateInvite} />
                        <button type="submit" className="primary-button" disabled={saving || loading || !linkedPlayers.length || !canCreateInvite}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Users className="h-4 w-4" aria-hidden="true" />}
                            {saving ? 'Creating invite...' : 'Create invite'}
                        </button>
                    </form>
                )}
            </section>

            <section className="app-card p-4">
                <ToolHeader icon={Users} title="Already linked family" detail="Parent and guardian accounts or contacts already connected to your linked players." />
                <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    {linkedContacts.length ? linkedContacts.map((contact) => {
                        const label = contact.name || contact.email || contact.phone || 'Family contact';
                        const showEmailMeta = Boolean(contact.email && contact.email !== label);
                        return (
                            <div key={`${contact.teamId}-${contact.playerId}-${contact.id}`} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <div className="truncate text-sm font-black leading-5 text-gray-950">{label}</div>
                                            {contact.email ? (
                                                <button type="button" className="ghost-button !h-7 !min-h-7 !w-7 !flex-none !p-0" onClick={() => copyEmail(contact.email)} aria-label={`Copy ${contact.email}`} title={copiedEmail === contact.email ? 'Copied' : 'Copy email'}>
                                                    {copiedEmail === contact.email ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                                                </button>
                                            ) : null}
                                        </div>
                                        <div className="text-xs font-semibold leading-4 text-gray-600">{contact.relation || 'Parent/guardian'} for {contact.playerName || 'Player'}{contact.playerNumber ? ` #${contact.playerNumber}` : ''}{contact.teamName ? ` - ${contact.teamName}` : ''}</div>
                                    </div>
                                    <span className={`flex-none rounded-full border px-2 py-0.5 text-[11px] font-black uppercase leading-4 ${contact.status === 'linked' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-600'}`}>
                                        {contact.status === 'linked' ? 'Linked' : 'Contact'}
                                    </span>
                                </div>
                                {showEmailMeta || contact.phone ? (
                                    <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-xs font-semibold leading-4 text-gray-600">
                                        {showEmailMeta ? <span className="truncate">{contact.email}</span> : null}
                                        {contact.phone ? <span className="truncate">{contact.phone}</span> : null}
                                    </div>
                                ) : null}
                            </div>
                        );
                    }) : <EmptyState icon={Users} title="No linked family contacts" detail="Linked parent and guardian contacts will appear here after they are saved on the player." />}
                </div>
            </section>

            <section className="app-card p-4">
                <ToolHeader icon={Users} title="Active household access" detail="Parent and caregiver accounts with active access to your linked players." />
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {activeMembers.length ? activeMembers.map((member) => (
                        <HouseholdMembershipCard key={member.id} member={member} currentUserId={auth.user?.uid || ''} revoking={revoking} onRevoke={() => setPendingRevokeMember(member)} />
                    )) : <EmptyState icon={Users} title="No active household access" detail="Accepted parent and caregiver access will appear here." />}
                </div>
            </section>

            <section className="app-card p-4">
                <ToolHeader icon={Users} title="Pending parent & caregiver invites" detail="Invites that have not been redeemed or removed." />
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {pendingMembers.length ? pendingMembers.map((member) => (
                        <HouseholdMembershipCard key={member.id} member={member} currentUserId={auth.user?.uid || ''} revoking={revoking} onRevoke={() => setPendingRevokeMember(member)} />
                    )) : <EmptyState icon={Users} title="No pending household invites" detail="Create an invite when a household member needs account-based access to a linked player." />}
                </div>
            </section>

            {pendingRevokeMember ? (
                <Modal
                    ariaLabelledBy="household-revoke-title"
                    onClose={() => {
                        if (!revoking) setPendingRevokeMember(null);
                    }}
                    overlayClassName="z-50 flex items-end justify-center bg-gray-950/40 px-4 py-5 sm:items-center"
                >
                    <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl">
                        <h3 id="household-revoke-title" className="text-base font-black text-gray-950">Revoke household access?</h3>
                        <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
                            {pendingRevokeMember.displayName || pendingRevokeMember.email || 'This caregiver'} will lose access to {pendingRevokeMember.playerName || 'this player'}.
                        </p>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <button type="button" className="secondary-button justify-center text-xs" onClick={() => setPendingRevokeMember(null)} disabled={revoking}>Cancel</button>
                            <button type="button" className="primary-button justify-center text-xs !bg-rose-600 hover:!bg-rose-700" onClick={() => revoke(pendingRevokeMember)} disabled={revoking}>
                                {revoking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                                Revoke access
                            </button>
                        </div>
                    </div>
                </Modal>
            ) : null}
        </div>
    );
}

function HouseholdMembershipCard({
    member,
    currentUserId,
    revoking,
    onRevoke
}: {
    member: ParentHouseholdFamilyMember;
    currentUserId: string;
    revoking: boolean;
    onRevoke: () => void;
}) {
    const status = String(member.status || '').toLowerCase();
    const label = member.displayName || member.email || 'Household contact';
    const playerLabel = member.playerName || 'Player';
    const canRevoke = Boolean(currentUserId && member.organizerUserId === currentUserId && (status === 'active' || status === 'pending'));
    const statusClassName = status === 'active'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-amber-200 bg-amber-50 text-amber-700';

    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black text-gray-950">{label}</div>
                    {member.email && member.email !== label ? <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{member.email}</div> : null}
                    <div className="mt-1 text-xs font-semibold text-gray-600">{member.relation || 'Household contact'} for {playerLabel}{member.playerNumber ? ` #${member.playerNumber}` : ''}{member.teamName ? ` - ${member.teamName}` : ''}</div>
                    {member.accessCode && status === 'pending' ? <div className="mt-2 text-xs font-semibold text-gray-600">Code <span className="font-mono">{member.accessCode}</span></div> : null}
                </div>
                <span className={`flex-none rounded-full border px-2 py-0.5 text-[11px] font-black uppercase leading-4 ${statusClassName}`}>{status}</span>
            </div>
            {canRevoke ? (
                <button type="button" className="ghost-button mt-3 !min-h-11 w-full justify-center text-xs text-rose-700" onClick={onRevoke} disabled={revoking} aria-label={`Revoke ${label} access to ${playerLabel}`}>
                    Revoke access
                </button>
            ) : null}
        </div>
    );
}
