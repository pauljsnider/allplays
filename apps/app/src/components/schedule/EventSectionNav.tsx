export type EventSectionNavSectionId = 'availability' | 'rideshare' | 'assignments' | 'game';

export interface EventSectionNavItem {
  id: EventSectionNavSectionId;
  label: string;
  shortLabel?: string;
}

interface EventSectionNavProps {
  className?: string;
  includeBaseClass?: boolean;
  sections: EventSectionNavItem[];
  activeSection: EventSectionNavSectionId;
  hasPracticePacket: boolean;
  onSelect: (sectionId: EventSectionNavSectionId) => void;
}

export function EventSectionNav({ className = '', includeBaseClass = true, sections, activeSection, hasPracticePacket, onSelect }: EventSectionNavProps) {
  return (
    <div className={`${includeBaseClass ? 'event-section-nav ' : ''}${className}`}>
      <div className="grid w-full grid-cols-4 gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
        {sections.map((section) => {
          const active = activeSection === section.id;
          const sectionHasPacket = section.id === 'game' && hasPracticePacket;
          return (
            <button
              key={section.id}
              type="button"
              className={`relative min-h-9 min-w-0 rounded-xl px-1 text-[11px] font-black leading-tight transition sm:px-3 sm:text-xs ${
                active ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'
              }`}
              onClick={() => onSelect(section.id)}
              aria-label={sectionHasPacket ? `${section.label}, packet ready` : section.label}
            >
              <span className="block truncate">{section.shortLabel || section.label}</span>
              {sectionHasPacket ? (
                <span className={`absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full ${active ? 'bg-white' : 'bg-blue-500'}`} aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
