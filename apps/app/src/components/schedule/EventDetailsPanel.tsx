import { CalendarDays, Clock, ClipboardCheck, ExternalLink, FileText, MapPin, Users, type LucideIcon } from 'lucide-react';
import {
  formatEventDateLabel,
  formatEventTimeLabel,
  getScheduleForecastHref,
  getScheduleMapHref,
  type ParentScheduleEvent
} from '../../lib/scheduleLogic';

export function EventDetailsPanel({ event, open }: { event: ParentScheduleEvent; open: boolean }) {
  if (!open) return null;
  const rows = getEventDetailRows(event);
  const mapHref = getScheduleMapHref(event.location);
  const forecastHref = getScheduleForecastHref(event.location);

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white">
      <dl className="divide-y divide-gray-200 px-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start gap-3 py-3">
            <div className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary-50 text-primary-600">
              <row.icon className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <dt className="text-sm font-black text-gray-950">{row.value}</dt>
              <dd className="mt-0.5 text-xs font-semibold text-gray-500">{row.label}</dd>
            </div>
          </div>
        ))}
      </dl>
      {(mapHref || forecastHref) ? (
        <div className="flex flex-wrap gap-2 border-t border-gray-100 p-3">
          {mapHref ? (
            <a href={mapHref} target="_blank" rel="noreferrer" className="secondary-button min-h-9 flex-1 px-3 py-2 text-xs">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Directions
            </a>
          ) : null}
          {forecastHref ? (
            <a href={forecastHref} target="_blank" rel="noreferrer" className="secondary-button min-h-9 flex-1 px-3 py-2 text-xs">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Forecast
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function getEventDetailRows(event: ParentScheduleEvent) {
  return [
    { label: 'Date', value: formatEventDateLabel(event.date), icon: CalendarDays },
    { label: 'Start time', value: formatEventTimeLabel(event.date), icon: Clock },
    event.endDate ? { label: 'End time', value: formatEventTimeLabel(event.endDate), icon: Clock } : null,
    event.arrivalTime ? { label: 'Arrival time', value: formatEventTimeLabel(event.arrivalTime), icon: Clock } : null,
    { label: 'Location', value: event.location || 'TBD', icon: MapPin },
    { label: 'Game info', value: formatGameInfo(event), icon: ClipboardCheck },
    event.seasonLabel ? { label: 'Season', value: event.seasonLabel, icon: CalendarDays } : null,
    event.competitionType ? { label: 'Competition', value: event.competitionType, icon: ClipboardCheck } : null,
    event.sourceLabel ? { label: 'Source', value: event.sourceLabel, icon: ExternalLink } : null,
    event.kitColor ? { label: 'Kit', value: event.kitColor, icon: Users } : null,
    event.practiceAttendanceSummary ? { label: 'Practice', value: event.practiceAttendanceSummary, icon: ClipboardCheck } : null,
    event.practiceHomePacketSummary ? { label: 'Home packet', value: event.practiceHomePacketSummary, icon: FileText } : null,
    event.notes ? { label: 'Notes', value: event.notes, icon: FileText } : null
  ].filter((row): row is { label: string; value: string; icon: LucideIcon } => Boolean(row));
}

function formatGameInfo(event: ParentScheduleEvent) {
  const pieces = [
    event.isHome === true ? 'Home' : event.isHome === false ? 'Away' : '',
    event.kitColor ? `${event.kitColor} kit` : '',
    event.countsTowardSeasonRecord === false ? 'Exhibition' : '',
    event.isCancelled ? 'Cancelled' : ''
  ].filter(Boolean);
  return pieces.length ? pieces.join(' · ') : 'Game-day details';
}
