interface EventBriefProps {
  pieces: string[];
}

export function EventBrief({ pieces }: EventBriefProps) {
  if (!pieces.length) return null;

  return (
    <div className="event-brief mt-1.5 flex-wrap gap-1 sm:mt-3 sm:gap-1.5">
      {pieces.map((piece) => (
        <span key={piece} className="inline-flex min-h-6 items-center rounded-full border border-gray-200 bg-white px-2 text-[11px] font-extrabold text-gray-700 sm:min-h-7 sm:px-2.5 sm:text-xs">
          {piece}
        </span>
      ))}
    </div>
  );
}
