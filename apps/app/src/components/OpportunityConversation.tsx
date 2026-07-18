import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Send, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getOpportunityInquiry, replyToOpportunityInquiry } from '../lib/opportunityService';
import type { OpportunityInquiry } from '../lib/opportunityLogic';
import type { AuthState } from '../lib/types';
import { Status } from './TeamSummaryPrimitives';

export function OpportunityConversation({ auth, inquiryId, embedded = false, onReplied }: {
  auth: AuthState;
  inquiryId: string;
  embedded?: boolean;
  onReplied?: (inquiry: OpportunityInquiry) => void;
}) {
  const [inquiry, setInquiry] = useState<OpportunityInquiry | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const loadRequestRef = useRef(0);
  const replyRequestRef = useRef(0);
  const activeInquiryIdRef = useRef(inquiryId);
  activeInquiryIdRef.current = inquiryId;

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    if (!inquiryId) {
      setInquiry(null);
      setLoading(false);
      return null;
    }
    setError('');
    try {
      const nextInquiry = await getOpportunityInquiry(inquiryId);
      if (requestId !== loadRequestRef.current) return null;
      setInquiry(nextInquiry);
      return nextInquiry;
    } catch (loadError: any) {
      if (requestId !== loadRequestRef.current) return null;
      setError(loadError?.message || 'Unable to load this opportunity conversation.');
      return null;
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [inquiryId]);

  useEffect(() => {
    replyRequestRef.current += 1;
    setMessage('');
    setSending(false);
    setInquiry(null);
    setLoading(true);
    void load();
    return () => {
      loadRequestRef.current += 1;
      replyRequestRef.current += 1;
    };
  }, [load]);

  const reply = async (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    const submittedInquiryId = inquiryId;
    const requestId = ++replyRequestRef.current;
    setSending(true);
    setError('');
    try {
      await replyToOpportunityInquiry(submittedInquiryId, message);
      if (requestId !== replyRequestRef.current || activeInquiryIdRef.current !== submittedInquiryId) return;
      setMessage('');
      const updated = await load();
      if (requestId !== replyRequestRef.current || activeInquiryIdRef.current !== submittedInquiryId) return;
      if (updated) onReplied?.(updated);
    } catch (replyError: any) {
      if (requestId !== replyRequestRef.current || activeInquiryIdRef.current !== submittedInquiryId) return;
      setError(replyError?.message || 'Unable to send your reply.');
    } finally {
      if (requestId === replyRequestRef.current && activeInquiryIdRef.current === submittedInquiryId) setSending(false);
    }
  };

  if (loading) return <div className={`${embedded ? 'h-full' : 'app-card'} flex min-h-64 items-center justify-center`}><Loader2 className="h-7 w-7 animate-spin text-primary-600" aria-label="Loading opportunity conversation" /></div>;
  if (!inquiry) return <div className={embedded ? 'p-4' : ''}><Status tone="error" message={error || 'Opportunity conversation not found.'} /></div>;

  return (
    <section className={`${embedded ? 'flex h-full min-h-0 flex-col bg-white' : 'app-card overflow-hidden'}`} aria-label={`Opportunity conversation: ${inquiry.listingTitle}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-4">
        <div className="min-w-0">
          <div className="app-label">Opportunity conversation</div>
          <h1 className="mt-1 truncate text-xl font-black text-gray-950">{inquiry.listingTitle}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-gray-500">
            <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{inquiry.participantIds.length} participant{inquiry.participantIds.length === 1 ? '' : 's'}</span>
            <span>Private · {inquiry.status}</span>
            <Link to={`/discover/opportunities/${encodeURIComponent(inquiry.listingId)}`} className="text-primary-700">View listing</Link>
          </div>
        </div>
        <button type="button" className="ghost-button !h-10 !min-h-10 !w-10 !p-0" onClick={() => void load()} aria-label="Refresh opportunity conversation"><RefreshCw className="h-4 w-4" /></button>
      </header>
      {error ? <div className="p-4 pb-0"><Status tone="error" message={error} /></div> : null}
      <div className={`${embedded ? 'min-h-0 flex-1 overflow-y-auto' : ''} space-y-3 bg-gray-50 p-4`}>
        {inquiry.messages.map((entry) => {
          const mine = entry.authorId === auth.user?.uid;
          return <div key={entry.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-2xl px-4 py-3 ${mine ? 'bg-primary-600 text-white' : 'border border-gray-200 bg-white text-gray-800'}`}><div className={`text-[10px] font-black uppercase tracking-[0.04em] ${mine ? 'text-primary-100' : 'text-gray-500'}`}>{entry.authorName}</div><div className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-5">{entry.body}</div></div></div>;
        })}
      </div>
      <form className="border-t border-gray-100 bg-white p-4" onSubmit={reply}>
        <label className="sr-only" htmlFor={`opportunity-reply-${inquiry.id}`}>Write a private reply</label>
        <textarea id={`opportunity-reply-${inquiry.id}`} className="auth-input min-h-24" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a private reply" required maxLength={1500} disabled={inquiry.status === 'closed'} />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-gray-500">Visible only to this conversation’s participants.</span>
          <button type="submit" className="primary-button" disabled={sending || !message.trim() || inquiry.status === 'closed' || !auth.user?.emailVerified}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send reply</button>
        </div>
      </form>
    </section>
  );
}
