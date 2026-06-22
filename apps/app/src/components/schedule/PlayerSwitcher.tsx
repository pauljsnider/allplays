import type { ParentScheduleEvent } from '../../lib/scheduleLogic';

export function PlayerSwitcher({
  events,
  selectedChildId,
  onSelect,
  compact = false
}: {
  events: ParentScheduleEvent[];
  selectedChildId: string;
  onSelect: (childId: string) => void;
  compact?: boolean;
}) {
  return (
    <div
      data-testid="event-player-switcher"
      className={`${compact ? 'flex-1 ' : 'mt-2 sm:mt-3 '}inline-flex max-w-full gap-1 rounded-full border border-gray-200 bg-gray-50 p-0.5`}
    >
      {events.map((event) => {
        const selected = event.childId === selectedChildId;
        return (
          <button
            key={event.childId}
            type="button"
            className={`min-h-7 min-w-16 rounded-full px-3 text-xs font-black transition ${
              selected ? 'bg-white text-primary-700 shadow-sm ring-1 ring-primary-100' : 'text-gray-600 hover:bg-white'
            }`}
            onClick={() => onSelect(event.childId)}
            aria-pressed={selected}
          >
            <span className="block truncate">{event.childName}</span>
          </button>
        );
      })}
    </div>
  );
}
