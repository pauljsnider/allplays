import { AvatarImage } from '../../../components/AvatarImage';
import type { ChatTeam } from '../../../lib/chatService';

export function TeamAvatar({ team }: { team: Pick<ChatTeam, 'name' | 'photoUrl' | 'unreadCount'> }) {
  return (
    <div className="relative flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-primary-50 text-primary-700 shadow-sm">
      {team.photoUrl ? (
        <AvatarImage
          src={team.photoUrl}
          alt={`${team.name} team photo`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          fallback={<span className="text-base font-black">{team.name.charAt(0).toUpperCase()}</span>}
        />
      ) : (
        <span className="text-base font-black">{team.name.charAt(0).toUpperCase()}</span>
      )}
      {team.unreadCount > 0 ? <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-600" /> : null}
    </div>
  );
}
