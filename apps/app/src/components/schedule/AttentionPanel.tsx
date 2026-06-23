import { AlertCircle, CheckCircle2 } from 'lucide-react';

export type ScheduleEventDetailSectionId = 'availability' | 'rideshare' | 'assignments' | 'game';

export type AttentionItem = {
  title: string;
  detail: string;
  section: ScheduleEventDetailSectionId;
};

export function AttentionPanel({ items, onSelectSection }: { items: AttentionItem[]; onSelectSection: (sectionId: ScheduleEventDetailSectionId) => void }) {
  if (!items.length) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
        <div>
          <div className="font-black">All caught up</div>
          <div className="mt-0.5 text-xs font-semibold text-emerald-700">No parent actions need attention right now.</div>
        </div>
      </div>
    );
  }

  const [primary, ...secondary] = items;

  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 sm:mt-3 sm:p-3">
      <div className="flex items-center gap-2 text-sm font-black text-amber-900">
        <AlertCircle className="h-4 w-4 flex-none" aria-hidden="true" />
        Needs attention
      </div>
      <button
        type="button"
        className="mt-2 flex w-full items-start justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-left transition hover:border-amber-300 hover:bg-amber-50 sm:py-2"
        onClick={() => onSelectSection(primary.section)}
      >
        <span>
          <span className="block text-sm font-black text-gray-950">{primary.title}</span>
          <span className="mt-0.5 block text-xs font-semibold leading-4 text-gray-600 sm:leading-5">{primary.detail}</span>
        </span>
        <span className="mt-0.5 flex-none text-xs font-black text-primary-700">Go</span>
      </button>
      {secondary.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {secondary.map((item) => (
            <button
              key={`${item.section}-${item.title}`}
              type="button"
              className="min-h-8 rounded-full border border-amber-200 bg-white px-3 text-xs font-black text-amber-900"
              onClick={() => onSelectSection(item.section)}
            >
              {item.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
