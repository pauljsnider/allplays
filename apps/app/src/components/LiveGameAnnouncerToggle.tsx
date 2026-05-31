import { Volume2, VolumeX } from 'lucide-react';

export function LiveGameAnnouncerToggle({
  enabled,
  supported,
  onToggle
}: {
  enabled: boolean;
  supported: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const Icon = enabled ? Volume2 : VolumeX;

  return (
    <div className="rounded-2xl border border-primary-100 bg-primary-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary-700" aria-hidden="true" />
          <div>
            <div className="text-sm font-black text-gray-950">Play-by-play audio</div>
            <div className="text-xs font-semibold leading-5 text-gray-600">
              {supported ? 'Announce new live game events aloud.' : 'Audio announcements are not supported on this device.'}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="secondary-button"
          aria-pressed={enabled}
          aria-label={enabled ? 'Disable play-by-play audio announcements' : 'Enable play-by-play audio announcements'}
          disabled={!supported}
          onClick={() => onToggle(!enabled)}
        >
          {enabled ? 'Audio on' : 'Audio off'}
        </button>
      </div>
    </div>
  );
}
