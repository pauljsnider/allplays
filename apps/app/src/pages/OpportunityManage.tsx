import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Inbox, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { OpportunityCard } from '../components/OpportunityCard';
import { Status } from '../components/TeamSummaryPrimitives';
import type { OpportunityInquiry, PublicOpportunity } from '../lib/opportunityLogic';
import {
  closePublicOpportunity,
  listMyPublicOpportunities,
  listOpportunityInquiries,
  listPublicOpportunityReports,
  moderatePublicOpportunity,
  renewPublicOpportunity,
  type OpportunityReport
} from '../lib/opportunityService';
import type { AuthState } from '../lib/types';

type ManageTab = 'listings' | 'inquiries' | 'reports';

export function OpportunityManage({ auth }: { auth: AuthState }) {
  const [tab, setTab] = useState<ManageTab>('listings');
  const [listings, setListings] = useState<PublicOpportunity[]>([]);
  const [inquiries, setInquiries] = useState<OpportunityInquiry[]>([]);
  const [inquiryCursor, setInquiryCursor] = useState<string | null>(null);
  const [reports, setReports] = useState<OpportunityReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [loadingMoreInquiries, setLoadingMoreInquiries] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const canModerateReports = auth.user?.isAdmin === true;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    if (!auth.user?.uid) {
      setListings([]);
      setInquiries([]);
      setInquiryCursor(null);
      setReports([]);
      setLoading(false);
      return;
    }
    try {
      setInquiryCursor(null);
      const [nextListings, inquiryPage, nextReports] = await Promise.all([
        listMyPublicOpportunities(),
        listOpportunityInquiries(),
        canModerateReports ? listPublicOpportunityReports() : Promise.resolve([])
      ]);
      setListings(nextListings);
      setInquiries(inquiryPage.items);
      setInquiryCursor(inquiryPage.nextCursor);
      setReports(nextReports);
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load opportunity management.');
    } finally {
      setLoading(false);
    }
  }, [auth.user?.uid, canModerateReports]);

  useEffect(() => { void load(); }, [load]);

  const loadMoreInquiries = async () => {
    if (!inquiryCursor || loadingMoreInquiries) return;
    setLoadingMoreInquiries(true);
    setError('');
    try {
      const page = await listOpportunityInquiries(inquiryCursor);
      setInquiries((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setInquiryCursor(page.nextCursor);
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load more inquiries.');
    } finally {
      setLoadingMoreInquiries(false);
    }
  };

  const lifecycle = async (item: PublicOpportunity, action: 'close' | 'renew') => {
    setBusyId(item.id);
    setError('');
    try {
      await (action === 'close' ? closePublicOpportunity(item.id) : renewPublicOpportunity(item.id));
      setStatus(action === 'close' ? 'Listing closed.' : 'Listing renewed for 30 days.');
      await load();
    } catch (actionError: any) {
      setError(actionError?.message || 'Unable to update this listing.');
    } finally {
      setBusyId('');
    }
  };

  const moderate = async (report: OpportunityReport, action: 'remove' | 'restore') => {
    setBusyId(report.id);
    try {
      await moderatePublicOpportunity(report.listingId, action);
      setStatus(action === 'remove' ? 'Listing removed.' : 'Listing restored for 30 days.');
      await load();
    } catch (moderationError: any) {
      setError(moderationError?.message || 'Unable to moderate this listing.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-4">
      <section className="app-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="app-label">Discover</div><h1 className="mt-1 text-2xl font-black text-gray-950">Listings and inquiries</h1><p className="mt-1 text-sm font-semibold text-gray-600">Manage public opportunities and private responses.</p></div><div className="flex gap-2"><button type="button" className="ghost-button !min-h-10" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Refresh</button><Link to="/discover/new" className="primary-button !min-h-10"><Plus className="h-4 w-4" />New listing</Link></div></div>
        <div className={`mt-4 grid gap-1 rounded-xl bg-gray-100 p-1 ${canModerateReports ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <TabButton active={tab === 'listings'} onClick={() => setTab('listings')} label={`My listings (${listings.length})`} />
          <TabButton active={tab === 'inquiries'} onClick={() => setTab('inquiries')} label={`Inquiries (${inquiries.length})`} />
          {canModerateReports ? <TabButton active={tab === 'reports'} onClick={() => setTab('reports')} label={`Reports (${reports.length})`} /> : null}
        </div>
      </section>
      {error ? <Status tone="error" message={error} /> : null}
      {status ? <Status tone="success" message={status} /> : null}
      {loading ? <div className="app-card p-8 text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-primary-600" /></div> : null}
      {!loading && tab === 'listings' ? listings.length ? <div className="grid gap-3 lg:grid-cols-2">{listings.map((item) => <div key={item.id} className="space-y-2"><OpportunityCard item={item} /><div className="flex gap-2 px-1"><Link to={`/discover/opportunities/${item.id}/edit`} className="ghost-button flex-1 justify-center !min-h-9 text-xs">Edit</Link>{item.status === 'active' ? <button type="button" className="ghost-button flex-1 justify-center !min-h-9 text-xs" disabled={busyId === item.id} onClick={() => void lifecycle(item, 'close')}>Close</button> : item.status === 'removed' ? <span className="flex flex-1 items-center justify-center text-xs font-black text-rose-700">Removed by moderation</span> : <button type="button" className="primary-button flex-1 justify-center !min-h-9 text-xs" disabled={busyId === item.id} onClick={() => void lifecycle(item, 'renew')}>Renew 30 days</button>}</div></div>)}</div> : <Empty icon={Plus} title="No listings yet" detail="Post a team opening, sports job, volunteer role, or guardian-safe looking-for-team listing." /> : null}
      {!loading && tab === 'inquiries' ? inquiries.length ? <div className="space-y-3">{inquiries.map((inquiry) => <Link key={inquiry.id} to={`/discover/inquiries/${inquiry.id}`} className="app-card flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Inbox className="h-5 w-5" /></div><span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-gray-950">{inquiry.listingTitle}</span><span className="mt-1 block text-xs font-semibold text-gray-500">Private inquiry · {inquiry.status}</span></span><span className="text-primary-700">›</span></Link>)}{inquiryCursor ? <button type="button" className="ghost-button mx-auto" disabled={loadingMoreInquiries} onClick={() => void loadMoreInquiries()}>{loadingMoreInquiries ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Load more inquiries</button> : null}</div> : <Empty icon={Inbox} title="No inquiries" detail="Private responses to your listings—and inquiries you send—will appear here." /> : null}
      {!loading && tab === 'reports' ? reports.length ? <div className="space-y-3">{reports.map((report) => <article key={report.id} className="app-card p-4"><div className="flex items-start gap-3"><AlertTriangle className="h-5 w-5 flex-none text-amber-600" /><div className="min-w-0 flex-1"><div className="text-sm font-black text-gray-950">{report.listingTitle}</div><div className="mt-1 text-sm font-semibold text-gray-600">{report.reason}</div><div className="mt-3 flex gap-2"><Link to={`/discover/opportunities/${report.listingId}`} className="ghost-button !min-h-9 text-xs">Review</Link><button type="button" className="primary-button !min-h-9 text-xs" disabled={busyId === report.id} onClick={() => void moderate(report, 'remove')}>Remove listing</button><button type="button" className="ghost-button !min-h-9 text-xs" disabled={busyId === report.id} onClick={() => void moderate(report, 'restore')}>Dismiss &amp; restore</button></div></div></div></article>)}</div> : <Empty icon={AlertTriangle} title="No open reports" detail="Reported public opportunities will appear here for platform review." /> : null}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button type="button" className={`min-h-10 rounded-lg px-2 text-xs font-black ${active ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'}`} onClick={onClick}>{label}</button>;
}

function Empty({ icon: Icon, title, detail }: { icon: typeof Plus; title: string; detail: string }) {
  return <div className="app-card p-8 text-center"><Icon className="mx-auto h-8 w-8 text-gray-300" /><div className="mt-3 text-sm font-black text-gray-900">{title}</div><div className="mt-1 text-xs font-semibold text-gray-500">{detail}</div></div>;
}
