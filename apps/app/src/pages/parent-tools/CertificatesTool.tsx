import { useCallback, useEffect, useState } from 'react';
import { Award, ExternalLink, RefreshCw, Share2 } from 'lucide-react';
import { loadParentCertificates, type ParentCertificateCard } from '../../lib/parentCertificatesService';
import { openPublicUrl, sharePublicUrl } from '../../lib/publicActions';
import type { AuthState } from '../../lib/types';
import { EmptyState, LoadingBlock, RetryableStatus, ToolHeader, useParentToolAsyncOperation } from './shared';

export function CertificatesTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
    const [cards, setCards] = useState<ParentCertificateCard[]>([]);
    const { loading, error, run: runLoad } = useParentToolAsyncOperation();

    const refresh = useCallback(async () => {
        return runLoad(
            () => loadParentCertificates(auth.user),
            'Unable to load awards.',
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
                <ToolHeader icon={Award} title="Awards" detail="Published certificates for linked players." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
                {error ? <RetryableStatus error={error} fallbackMessage="Unable to load awards." onRetry={refresh} retrying={loading} /> : null}
            </section>
            {!error && (loading ? <LoadingBlock label="Loading awards" /> : (
                <div className="grid gap-3 lg:grid-cols-2">
                    {cards.length ? cards.map((card) => <CertificateCard key={`${card.teamId}-${card.playerId}-${card.id}`} card={card} />) : (
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
