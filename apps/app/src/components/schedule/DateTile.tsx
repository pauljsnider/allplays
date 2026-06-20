import { formatDateTileParts } from '../../lib/datetime';

interface DateTileProps {
  date: Date;
}

export function DateTile({ date }: DateTileProps) {
  const { month, day, weekday } = formatDateTileParts(date);

  return (
    <div className="flex h-12 w-12 flex-none flex-col items-center justify-center rounded-xl bg-gray-50 shadow-inner ring-1 ring-gray-200 sm:h-16 sm:w-16 sm:rounded-2xl">
      <div className="text-[10px] font-black uppercase leading-none tracking-[0.06em] text-gray-500 sm:text-[11px]">{month}</div>
      <div className="mt-0.5 text-lg font-black leading-none text-gray-950 sm:text-2xl">{day}</div>
      <div className="mt-0.5 text-[10px] font-black uppercase leading-none tracking-[0.06em] text-gray-500 sm:mt-1 sm:tracking-[0.08em]">{weekday}</div>
    </div>
  );
}
