import { FormEvent, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Loader2, MapPin, MessageCircle, ShieldCheck } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Status } from '../components/TeamSummaryPrimitives';
import {
  formatOpportunityDate,
  formatOpportunityLocation,
  getOpportunityKindLabel,
  type PublicOpportunity
} from '../lib/opportunityLogic';
import { createOpportunityInquiry, getPublicOpportunity, reportPublicOpportunity } from '../lib/opportunityService';
import type { AuthState } from '../lib/types';

export function OpportunityDetail({ auth }: { auth: AuthState }) {
  const { listingId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<PublicOpportunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');
  const [contactOpen, setContactOpen] = useState(searchParams.get('contact') === '1');

  useEffect(() => {
    let active = true;
    setLoading(true);
    getPublicOpportunity(listingId)
      .then((result) => { if (active) setItem(result); })
      .catch((loadError: any) => { if (active) setError(loadError?.message || 'Unable to load this opportunity.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [listingId]);

  const openContact = () => {
    if (!auth.user) {
      const next = `/discover/opportunities/${encodeURIComponent(listingId)}?contact=1`;
      navigate(`/auth?next=${encodeURIComponent(next)}`);
      return;
    }
    setContactOpen(true);
  };

  const submitInquiry = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError('');
    try {
      const inquiry = await createOpportunityInquiry(listingId, message);
      navigate(`/discover/inquiries/${encodeURIComponent(inquiry.id)}`);
    } catch (sendError: any) {
      setError(sendError?.message || 'Unable to send this inquiry.');
    } finally {
      setSending(false);
    }
  };

  const report = async () => {
    if (!auth.user) {
      navigate(`/auth?next=${encodeURIComponent(`/discover/opportunities/${listingId}`)}`);
      return;
    }
    const reason = window.prompt('Why should this listing be reviewed?');
    if (!reason?.trim()) return;
    try {
      await reportPublicOpportunity(listingId, reason);
      setStatus('Report submitted for review.');
    } catch (reportError: any) {
      setError(reportError?.message || 'Unable to submit the report.');
    }
  };

  if (loading) return <div className="app-card p-8 text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-primary-600" /><div className="mt-2 text-sm font-black">Loading opportunity</div></div>;
  if (error && !item) return <Status tone="error" message={error} />;
  if (!item) return null;
  const location = formatOpportunityLocation(item);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div><Link to="/discover" className="text-sm font-black text-primary-700">← Back to Discover</Link></div>
      {error ? <Status tone="error" message={error} /> : null}
      {status ? <Status tone="success" message={status} /> : null}
      <article className="app-card overflow-hidden">
        <div className="border-b border-gray-100 p-5 sm:p-7">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-black text-primary-700">{getOpportunityKindLabel(item.kind)}</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-black ${item.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{item.status}</span>
          </div>
          <h1 className="mt-3 text-2xl font-black leading-tight text-gray-950 sm:text-3xl">{item.title}</h1>
          {item.teamName ? <div className="mt-2 text-sm font-black text-gray-700">{item.teamName}</div> : <div className="mt-2 text-sm font-black text-gray-700">Guardian-safe community listing</div>}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm font-bold text-gray-600">
            <span>{item.sport}</span>
            {item.ageGroup ? <span>{item.ageGroup}</span> : null}
            {item.role ? <span>{item.role}</span> : null}
            {location ? <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{location}</span> : null}
            {item.expiresAt ? <span className="inline-flex items-center gap-1"><CalendarClock className="h-4 w-4" />Ends {formatOpportunityDate(item.expiresAt)}</span> : null}
          </div>
        </div>
        <div className="space-y-5 p-5 sm:p-7">
          <section><h2 className="app-label">About this opportunity</h2><p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-gray-700">{item.description}</p></section>
          <div className="grid gap-3 sm:grid-cols-2">
            <Detail label="Level" value={item.competitiveLevel} />
            <Detail label="Division" value={item.division} />
            <Detail label="Availability" value={item.availability} />
            <Detail label="Start date" value={item.startDate} />
            <Detail label="Compensation" value={item.compensationType === 'not_applicable' ? '' : `${item.compensationType.replace('_', ' ')}${item.compensationSummary ? ` · ${item.compensationSummary}` : ''}`} />
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold leading-5 text-blue-900"><ShieldCheck className="mr-1 inline h-4 w-4" />ALL PLAYS does not verify employment terms, background checks, or listing claims. Use the private inquiry thread and independently verify the opportunity.</div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-gray-100 bg-gray-50 p-4">
          <button type="button" className="primary-button !min-h-10 !px-4" onClick={openContact} disabled={item.status !== 'active'}><MessageCircle className="h-4 w-4" />{auth.user ? 'Send private inquiry' : 'Sign in to contact'}</button>
          <button type="button" className="ghost-button !min-h-10 !px-4" onClick={() => void report()}><AlertTriangle className="h-4 w-4" />Report</button>
          {item.teamId ? <Link className="ghost-button !min-h-10 !px-4" to={`/teams/${encodeURIComponent(item.teamId)}`}>View public team</Link> : null}
        </div>
      </article>

      {contactOpen && item.status === 'active' ? <form className="app-card p-4 sm:p-5" onSubmit={submitInquiry}>
        <h2 className="app-section-title">Private inquiry</h2>
        <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">Your message is visible only to you and the listing owner or team administrators. Contact details are never shown on the public listing.</p>
        <textarea className="auth-input mt-3 min-h-32" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Introduce yourself and ask about the opportunity. Do not include sensitive information." required />
        <div className="mt-3 flex justify-end gap-2"><button type="button" className="ghost-button" onClick={() => setContactOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={sending || !message.trim()}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}Send inquiry</button></div>
      </form> : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><div className="app-label">{label}</div><div className="mt-1 text-sm font-bold text-gray-800">{value}</div></div>;
}
