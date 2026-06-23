import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Copy, Loader2, RefreshCw, Share2 } from 'lucide-react';
import { createParentFamilyShare, loadFamilyShareModel, revokeParentFamilyShare, updateParentFamilyShareCalendars, type FamilyShareTokenCard } from '../../lib/parentToolsService';
import { sharePublicUrl } from '../../lib/publicActions';
import type { AuthState } from '../../lib/types';
import { EmptyState, LoadingBlock, RetryableStatus, Status, ToolHeader, copyText, splitLines, useParentToolAsyncOperation } from './shared';

export function FamilyShareTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
    const [tokens, setTokens] = useState<FamilyShareTokenCard[]>([]);
    const [children, setChildren] = useState<any[]>([]);
    const [label, setLabel] = useState('');
    const [calendarText, setCalendarText] = useState('');
    const [editingTokenId, setEditingTokenId] = useState('');
    const [pendingRevokeToken, setPendingRevokeToken] = useState<FamilyShareTokenCard | null>(null);
    const [message, setMessage] = useState('');
    const loadOperation = useParentToolAsyncOperation();
    const saveOperation = useParentToolAsyncOperation();
    const runLoad = loadOperation.run;
    const runSave = saveOperation.run;
    const clearLoadError = loadOperation.clearError;
    const clearSaveError = saveOperation.clearError;
    const loading = loadOperation.loading;
    const saving = saveOperation.loading;
    const error = loadOperation.error ?? saveOperation.error;

    const refresh = useCallback(async () => {
        clearLoadError();
        clearSaveError();
        return runLoad(
            () => loadFamilyShareModel(auth.user),
            'Unable to load family share links.',
            {
                onSuccess: (model) => {
                    setChildren(model.children);
                    setTokens(model.tokens);
                }
            }
        );
    }, [auth.user, clearLoadError, clearSaveError, runLoad]);

    useEffect(() => {
        void refresh();
    }, [auth.user?.uid, refresh, refreshVersion]);

    const create = async (event: FormEvent) => {
        event.preventDefault();
        clearSaveError();
        setMessage('');
        await runSave(
            () => createParentFamilyShare(auth.user, label || 'Family share', splitLines(calendarText)),
            'Unable to create family share link.',
            {
                onSuccess: async (result) => {
                    setMessage('Family link created.');
                    setLabel('');
                    setCalendarText('');
                    await copyText(result.url, setMessage);
                    await refresh();
                }
            }
        );
    };

    const revoke = async (tokenId: string) => {
        clearSaveError();
        setMessage('');
        await runSave(
            () => revokeParentFamilyShare(tokenId),
            'Unable to revoke family share link.',
            {
                onSuccess: async () => {
                    setMessage('Family link revoked.');
                    await refresh();
                },
                onFinally: () => {
                    setPendingRevokeToken(null);
                }
            }
        );
    };

    const saveCalendars = async (tokenId: string, value: string) => {
        clearSaveError();
        setMessage('');
        await runSave(
            () => updateParentFamilyShareCalendars(tokenId, splitLines(value)),
            'Unable to update calendar links.',
            {
                onSuccess: async () => {
                    setEditingTokenId('');
                    setMessage('Calendar links updated.');
                    await refresh();
                }
            }
        );
    };

    return (
        <div className="space-y-3">
            <section className="app-card p-4">
                <ToolHeader icon={Share2} title="Family share" detail="Share a private family page with relatives and caregivers." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
                {error ? <RetryableStatus error={error} fallbackMessage="Unable to load family share links." onRetry={loading ? undefined : refresh} retrying={loading} /> : null}
                {message ? <Status tone="success" message={message} /> : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {children.length ? children.map((child) => (
                        <span key={`${child.teamId}-${child.playerId}`} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-black text-gray-700">{child.playerName || 'Player'}</span>
                    )) : <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-800">No linked players</span>}
                </div>
                <form className="mt-3 grid gap-3" onSubmit={create}>
                    <input className="auth-input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label, like Grandma or babysitter" />
                    <textarea className="auth-input min-h-24 resize-none" value={calendarText} onChange={(event) => setCalendarText(event.target.value)} placeholder="Optional external calendar feed URLs, one per line" />
                    <button type="submit" className="primary-button" disabled={saving || loading || !children.length}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Share2 className="h-4 w-4" aria-hidden="true" />}
                        Create share link
                    </button>
                </form>
            </section>

            {loading ? <LoadingBlock label="Loading share links" /> : (
                <div className="grid gap-3 lg:grid-cols-2">
                    {tokens.length ? tokens.map((token) => (
                        <FamilyTokenCard
                            key={token.id}
                            token={token}
                            editing={editingTokenId === token.id}
                            saving={saving}
                            onEdit={() => setEditingTokenId(token.id)}
                            onCancel={() => setEditingTokenId('')}
                            onCopy={(text) => copyText(text, setMessage)}
                            onShare={() => sharePublicUrl({ title: 'ALL PLAYS family page', text: token.label || 'Family schedule', url: token.url })}
                            onRevoke={() => setPendingRevokeToken(token)}
                            onSaveCalendars={saveCalendars}
                        />
                    )) : <EmptyState icon={Share2} title="No family links" detail="Create a link when someone needs schedule access without a full account." />}
                </div>
            )}

            {pendingRevokeToken ? (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/40 px-4 py-5 sm:items-center" role="presentation">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="family-share-revoke-title">
                        <h3 id="family-share-revoke-title" className="text-base font-black text-gray-950">Revoke this share link?</h3>
                        <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
                            Anyone using the family share link{pendingRevokeToken.label ? ` for ${pendingRevokeToken.label}` : ''} will lose access.
                        </p>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <button type="button" className="secondary-button justify-center text-xs" onClick={() => setPendingRevokeToken(null)} disabled={saving}>Cancel</button>
                            <button type="button" className="primary-button justify-center text-xs !bg-rose-600 hover:!bg-rose-700" onClick={() => revoke(pendingRevokeToken.id)} disabled={saving}>
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                                Revoke link
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function FamilyTokenCard({ token, editing, saving, onEdit, onCancel, onCopy, onShare, onRevoke, onSaveCalendars }: {
    token: FamilyShareTokenCard;
    editing: boolean;
    saving: boolean;
    onEdit: () => void;
    onCancel: () => void;
    onCopy: (value: string) => void;
    onShare: () => void;
    onRevoke: () => void;
    onSaveCalendars: (tokenId: string, value: string) => void;
}) {
    const [calendarText, setCalendarText] = useState('');

    useEffect(() => {
        if (editing) setCalendarText((token.extraCalendarUrls || []).join('\n'));
    }, [editing, token.extraCalendarUrls]);

    return (
        <section className="app-card p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-sm font-black text-gray-950">{token.label || 'Family share link'}</div>
                    <div className="mt-0.5 text-xs font-semibold text-gray-500">{token.childCount} player{token.childCount === 1 ? '' : 's'} included</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${token.revokedAt || token.revoked ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {token.revokedAt || token.revoked ? 'Revoked' : 'Active'}
                </span>
            </div>
            <div className="mt-3 break-all rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs font-semibold text-gray-600">{token.url}</div>
            {editing ? (
                <div className="mt-3 space-y-2">
                    <textarea className="auth-input min-h-24 resize-none" value={calendarText} onChange={(event) => setCalendarText(event.target.value)} placeholder="External calendar feed URLs, one per line" />
                    <div className="grid grid-cols-2 gap-2">
                        <button type="button" className="secondary-button justify-center text-xs" onClick={onCancel} disabled={saving}>Cancel</button>
                        <button type="button" className="primary-button justify-center text-xs" onClick={() => onSaveCalendars(token.id, calendarText)} disabled={saving}>Save calendars</button>
                    </div>
                </div>
            ) : (
                <div className="mt-3 grid grid-cols-4 gap-2">
                    <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => onCopy(token.url)}><Copy className="h-4 w-4" aria-hidden="true" />Copy</button>
                    <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={onShare}><Share2 className="h-4 w-4" aria-hidden="true" />Share</button>
                    <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={onEdit}>Feeds</button>
                    <button type="button" className="ghost-button !min-h-9 justify-center text-xs text-rose-700" onClick={onRevoke} disabled={saving || token.revokedAt || token.revoked}>Revoke</button>
                </div>
            )}
        </section>
    );
}
