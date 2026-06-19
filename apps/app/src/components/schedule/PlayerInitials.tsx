interface PlayerInitialsProps {
  name: string;
}

export function PlayerInitials({ name }: PlayerInitialsProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'P';

  return (
    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-gray-700 to-gray-950 text-sm font-black text-white shadow-sm sm:h-11 sm:w-11">
      {initials}
    </div>
  );
}
