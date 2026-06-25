import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Share2, Ticket } from 'lucide-react';
import { Link } from 'react-router-dom';
import { loadParentRegistrations, type ParentRegistrationCard } from '../../lib/parentRegistrationsService';
import { openPublicUrl, sharePublicUrl } from '../../lib/publicActions';
import type { AuthState } from '../../lib/types';
import { EmptyState, LoadingBlock, MetricCard, RetryableStatus, ToolHeader, useParentToolAsyncOperation } from './shared';

export function RegistrationsTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
    const [cards, setCards] = useState<ParentRegistrationCard[]>([]);
    const { loading, error, run: runLoad } = useParentToolAsyncOperation();

    const refresh = useCallback(async () => {
        return runLoad(
            () => loadParentRegistrations(auth.user),
            'Unable to load registrations.',
            {
                onSuccess: (result) => {
                    setCards(result);
                }
            }
        );
    }, [auth.user, runLoad]);

    useEffect(() => {
        void refresh();
    }, [auth.user?.uid, refresh, refreshVersion]);

    return (
        <div className="space-y-3">
            <section className="app-card p-4">
                <ToolHeader icon={Ticket} title="Registrations" detail="Published team registration forms linked to your family." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
                {error ? <RetryableStatus error={error} fallbackMessage="Unable to load registrations." onRetry={refresh} retrying={loading} /> : null}
            </section>
            {loading ? <LoadingBlock label="Loading registrations" /> : (
                <div className="grid gap-3 lg:grid-cols-2">
                    {cards.length ? cards.map((card) => <RegistrationCard key={`${card.teamId}-${card.id}`} card={card} />) : (
                        <EmptyState icon={Ticket} title="No open registrations" detail="Published registration forms will appear here." />
                    )}
                </div>
            )}
        </div>
    );
}

function RegistrationCard({ card }: { card: ParentRegistrationCard }) {
    const shareUrl = card.appUrl || card.url;
    return (
        <section className="app-card p-4">
            <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                    <Ticket className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black text-gray-950">{card.programName}</div>
                    <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{card.teamName}{card.season ? ` - ${card.season}` : ''}</div>
                    {card.description ? <div className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-gray-600">{card.description}</div> : null}
                </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <MetricCard label="Fee" value={card.feeLabel} />
                <MetricCard label="Options" value={String(card.options.length)} />
                <MetricCard label="Checkout" value={card.onlineCheckout ? 'Online' : 'Offline'} />
            </div>
            {card.paymentNotice ? <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold text-blue-800">{card.paymentNotice}</div> : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
                <Link to={`/parent-tools/registrations/${card.teamId}/${card.id}`} className="primary-button justify-center text-xs">
                    <Ticket className="h-4 w-4" aria-hidden="true" />
                    Review
                </Link>
                <button type="button" className="secondary-button justify-center text-xs" onClick={() => openPublicUrl(card.url)}>
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    Legacy form
                </button>
                <button type="button" className="secondary-button justify-center text-xs sm:col-span-2" onClick={() => sharePublicUrl({ title: card.programName, text: `${card.teamName} registration`, url: shareUrl })}>
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                    Share
                </button>
            </div>
        </section>
    );
}
