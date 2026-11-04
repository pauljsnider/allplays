import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { confirmMcpActionReview, loadMcpActionReview, prepareMcpActionReview } from '../lib/mcpActionReviewService';
import type { AuthState } from '../lib/types';

type Review = Awaited<ReturnType<typeof loadMcpActionReview>>;

function fieldLabel(key: string) {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ReviewDetails({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <ol className="list-decimal space-y-2 pl-5">
        {value.map((entry, index) => (
          <li key={index}>
            <ReviewDetails value={entry} />
          </li>
        ))}
      </ol>
    );
  }
  if (value && typeof value === 'object') {
    return (
      <dl className="space-y-2">
        {Object.entries(value).map(([key, entry]) => (
          <div key={key} className="border-l border-gray-200 pl-3">
            <dt className="text-sm font-semibold">{fieldLabel(key)}</dt>
            <dd className="text-sm break-words whitespace-pre-wrap">
              <ReviewDetails value={entry} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <>{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value == null || value === '' ? 'None' : String(value)}</>;
}

export function McpActionReview({ auth }: { auth: AuthState }) {
  const { requestId = '' } = useParams();
  const [review, setReview] = useState<Review | null>(null);
  const [message, setMessage] = useState('Loading review request…');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    let current = true;
    setReview(null);
    setFinished(false);
    if (auth.user)
      loadMcpActionReview(auth.user, requestId)
        .then((value) => {
          if (current) {
            setReview(value);
            setMessage('');
          }
        })
        .catch((error: Error) => {
          if (current) setMessage(error.message);
        });
    return () => {
      current = false;
    };
  }, [auth.user, requestId]);

  const act = async (confirm: boolean) => {
    if (!auth.user || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (confirm) {
        if (!review?.pending) throw new Error('Review the prepared change first.');
        const { status, result } = await confirmMcpActionReview(auth.user, requestId, review.pending);
        setFinished(status !== 'partial');
        if (status === 'partial') setReview(await loadMcpActionReview(auth.user, requestId));
        setMessage(
          status === 'completed'
            ? 'Change completed.'
            : status === 'partial'
              ? 'Some changes completed. Review the remaining items below before confirming again; completed items will not be repeated.'
              : result.error || 'The change could not be completed. Check current app data before retrying.'
        );
      } else {
        setReview(await prepareMcpActionReview(auth.user, requestId));
        setMessage('Review the prepared details below before confirming.');
      }
    } catch (error: unknown) {
      setFinished(true);
      setMessage(
        `${error instanceof Error ? error.message : 'Unable to verify the request.'} Reload to check its status. Do not repeat a change whose outcome is uncertain.`
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const status = review?.request.reviewStatus;
  const actionable = status === 'requested' || status === 'prepared' || status === 'partial';
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-2xl font-bold">Review a ChatGPT request</h1>
      <p>Nothing is applied until you review the prepared change and select Confirm change.</p>
      {message && <p role="status">{message}</p>}
      {review && (
        <section className="app-card space-y-3 p-4">
          <h2 className="text-lg font-bold">{fieldLabel(review.request.requestTool)}</h2>
          <p>Status: {status}</p>
          {review.pending?.summary && <p>{review.pending.summary}</p>}
          <h3 className="font-bold">{review.pending ? 'Prepared details' : 'Requested details'}</h3>
          <ReviewDetails value={review.pending?.previewSummary || review.request.args} />
          {review.pending && (
            <details open>
              <summary>Complete change details</summary>
              <ReviewDetails value={review.pending.args} />
            </details>
          )}
          {actionable && !finished && (
            <button type="button" className="primary-button" disabled={busy} onClick={() => void act(status !== 'requested')}>
              {busy
                ? 'Working…'
                : status === 'partial'
                  ? 'Confirm remaining changes'
                  : status === 'prepared'
                    ? 'Confirm change'
                    : 'Prepare for review'}
            </button>
          )}
          {!actionable && (
            <p>
              {status === 'completed'
                ? 'This request has already completed.'
                : 'This request cannot be repeated here. Check current app data before creating another request.'}
            </p>
          )}
        </section>
      )}
      <Link to="/ai">Open AllPlays AI</Link>
    </main>
  );
}
