import type { ReactNode } from 'react';
import { DateTile } from './DateTile';
import { EventBrief } from './EventBrief';

interface ScheduleEventHeaderProps {
  date: Date;
  teamName: string;
  eventType: 'practice' | 'game';
  title: string;
  timeLabel: string;
  location?: string | null;
  playerSummary: ReactNode;
  rsvpLabel: string;
  rsvpClassName: string;
  briefPieces: string[];
}

export function ScheduleEventHeader({
  date,
  teamName,
  eventType,
  title,
  timeLabel,
  location,
  playerSummary,
  rsvpLabel,
  rsvpClassName,
  briefPieces
}: ScheduleEventHeaderProps) {
  return (
    <>
      <div className="mt-1.5 flex items-start gap-2.5 sm:mt-2 sm:gap-3">
        <DateTile date={date} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-xs font-black uppercase tracking-[0.04em] text-gray-500">{teamName}</span>
            <span className={`inline-flex min-h-5 flex-none items-center rounded-full px-2 text-[10px] font-extrabold uppercase tracking-[0.04em] ${eventType === 'practice' ? 'bg-amber-100 text-amber-800' : 'bg-primary-100 text-primary-800'}`}>
              {eventType}
            </span>
          </div>
          <h1 className="mt-0.5 text-lg font-black leading-tight text-gray-950 sm:text-2xl">{title}</h1>
          <div className="mt-0 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-xs font-bold leading-5 text-gray-600 sm:text-sm">
            <span>{timeLabel}</span>
            <span className="min-w-0 truncate">{location || 'Location TBD'}</span>
          </div>
        </div>
      </div>

      <div className="mt-1 flex min-w-0 items-center justify-between gap-2 sm:mt-2">
        <div className="min-w-0 flex-1">{playerSummary}</div>
        <span className={`inline-flex min-h-6 flex-none items-center rounded-full border px-2 text-[10px] font-extrabold uppercase tracking-[0.04em] ${rsvpClassName}`}>
          {rsvpLabel}
        </span>
      </div>

      <EventBrief pieces={briefPieces} />
    </>
  );
}
