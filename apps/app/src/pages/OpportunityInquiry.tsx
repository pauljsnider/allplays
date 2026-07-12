import { FormEvent, useEffect, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Status } from '../components/TeamSummaryPrimitives';
import type { OpportunityInquiry as Inquiry } from '../lib/opportunityLogic';
import { getOpportunityInquiry, replyToOpportunityInquiry } from '../lib/opportunityService';
import type { AuthState } from '../lib/types';

export function OpportunityInquiry({ auth }: { auth: AuthState }) {
  const { inquiryId = '' } = useParams();
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try { setInquiry(await getOpportunityInquiry(inquiryId)); }
    catch (loadError: any) { setError(loadError?.message || 'Unable to load this inquiry.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [inquiryId]);

  const reply = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError('');
    try {
      await replyToOpportunityInquiry(inquiryId, message);
      setMessage('');
      await load();
    } catch (replyError: any) {
      setError(replyError?.message || 'Unable to send your reply.');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="app-card p-8 text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-primary-600" /></div>;
  if (!inquiry) return <Status tone="error" message={error || 'Inquiry not found.'} />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div><Link to="/discover/manage" className="text-sm font-black text-primary-700">← Back to inquiries</Link></div>
      <section className="app-card overflow-hidden">
        <div className="border-b border-gray-100 p-4"><div className="app-label">Private opportunity inquiry</div><h1 className="mt-1 text-xl font-black text-gray-950">{inquiry.listingTitle}</h1><Link to={`/discover/opportunities/${inquiry.listingId}`} className="mt-2 inline-block text-xs font-black text-primary-700">View public listing</Link></div>
        {error ? <div className="p-4"><Status tone="error" message={error} /></div> : null}
        <div className="space-y-3 bg-gray-50 p-4">
          {inquiry.messages.map((entry) => {
            const mine = entry.authorId === auth.user?.uid;
            return <div key={entry.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-2xl px-4 py-3 ${mine ? 'bg-primary-600 text-white' : 'border border-gray-200 bg-white text-gray-800'}`}><div className={`text-[10px] font-black uppercase tracking-[0.04em] ${mine ? 'text-primary-100' : 'text-gray-500'}`}>{entry.authorName}</div><div className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-5">{entry.body}</div></div></div>;
          })}
        </div>
        <form className="border-t border-gray-100 p-4" onSubmit={reply}><textarea className="auth-input min-h-28" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a private reply" required /><div className="mt-3 flex justify-end"><button type="submit" className="primary-button" disabled={sending || !message.trim()}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send reply</button></div></form>
      </section>
    </div>
  );
}
