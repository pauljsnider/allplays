import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Award, ExternalLink, RefreshCw, Share2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { loadParentCertificates, type LoadParentCertificatesOptions, type ParentCertificateCard } from '../../lib/parentCertificatesService';
import { openPublicUrl, sharePublicUrl } from '../../lib/publicActions';
import type { AuthState } from '../../lib/types';
import { EmptyState, LoadingBlock, RetryableStatus, ToolHeader, useParentToolAsyncOperation } from './shared';

export function CertificatesTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
    const [searchParams] = useSearchParams();
    const [cards, setCards] = useState<ParentCertificateCard[]>([]);
    const [showAllAwards, setShowAllAwards] = useState(false);
    const { loading, error, run: runLoad } = useParentToolAsyncOperation();
    const requestedTeamId = String(searchParams.get('teamId') || '').trim();
    const requestedCertificateId = String(searchParams.get('certificateId') || '').trim();
    const hasRequestedCertificate = Boolean(requestedTeamId && requestedCertificateId);

    const refresh = useCallback(async () => {
        const loadOptions: LoadParentCertificatesOptions = hasRequestedCertificate
            ? { requestedTeamId, requestedCertificateId }
            : {};
        return runLoad(
            () => loadParentCertificates(auth.user, loadOptions),
            'Unable to load awards.',
            {
                onSuccess: (result) => {
                    setCards(result);
                }
            }
        );
    }, [auth.user, hasRequestedCertificate, requestedCertificateId, requestedTeamId, runLoad]);

    useEffect(() => {
        void refresh();
    }, [auth.user?.uid, refresh, refreshVersion]);

    useEffect(() => {
        setShowAllAwards(false);
    }, [requestedCertificateId, requestedTeamId]);

    const requestedCard = useMemo(() => {
        if (!hasRequestedCertificate) return null;
        return cards.find((card) => String(card.teamId || '') === requestedTeamId && String(card.id || '') === requestedCertificateId) || null;
    }, [cards, hasRequestedCertificate, requestedCertificateId, requestedTeamId]);

    const visibleCards = useMemo(() => {
        if (requestedCard && !showAllAwards) {
            return [requestedCard];
        }
        return cards;
    }, [cards, requestedCard, showAllAwards]);

    const missingRequestedCard = hasRequestedCertificate && !loading && !error && !requestedCard;

    return (
        <div className="space-y-3">
            <section className="app-card p-4">
                <ToolHeader icon={Award} title="Awards" detail="Published certificates for linked players." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
                {error ? <RetryableStatus error={error} fallbackMessage="Unable to load awards." onRetry={refresh} retrying={loading} /> : null}
                {!error && requestedCard ? (
                    <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="font-black">Opened from a notification</div>
                                <div className="mt-1 text-xs leading-5 text-blue-800">Showing {requestedCard.playerName}&apos;s {requestedCard.title || requestedCard.awardTitle || 'award'} first.</div>
                            </div>
                            {!showAllAwards ? (
                                <button type="button" className="ghost-button !min-h-8 !px-2 text-xs" onClick={() => setShowAllAwards(true)}>
                                    Show all awards
                                </button>
                            ) : null}
                        </div>
                    </div>
                ) : null}
                {!error && missingRequestedCard ? (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                        <span>That award is no longer available. Showing all published awards instead.</span>
                    </div>
                ) : null}
            </section>
            {!error && (loading ? <LoadingBlock label="Loading awards" /> : (
                <div className="grid gap-3 lg:grid-cols-2">
                    {visibleCards.length ? visibleCards.map((card) => <CertificateCard key={`${card.teamId}-${card.playerId}-${card.id}`} card={card} />) : (
                        <EmptyState icon={Award} title="No published awards" detail="Awards appear after a coach publishes certificates." />
                    )}
                </div>
            ))}
        </div>
    );
}

function CertificateCard({ card }: { card: ParentCertificateCard }) {
    return (
        <section className="app-card p-4">
            <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                    <Award className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black text-gray-950">{card.title || card.awardTitle || 'Award'}</div>
                    <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{card.playerName} - {card.teamName}</div>
                    {card.narrative || card.description ? <div className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-gray-600">{card.narrative || card.description}</div> : null}
                </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className="secondary-button justify-center text-xs" onClick={() => openPublicUrl(card.url)}>
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    Open
                </button>
                <button type="button" className="secondary-button justify-center text-xs" onClick={() => sharePublicUrl({ title: card.title || 'ALL PLAYS award', text: `${card.playerName} award`, url: card.url })}>
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                    Share
                </button>
            </div>
        </section>
    );
}
