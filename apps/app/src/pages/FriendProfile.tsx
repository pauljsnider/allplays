import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Heart, Loader2, UsersRound } from 'lucide-react';
import { AvatarImage } from '../components/AvatarImage';
import {
  loadFriendProfile,
  reactToSocialPost,
  type FriendProfileModel
} from '../lib/socialService';
import { getSocialTypeLabel, getSocialVisibilityLabel, type SocialFeedItem } from '../lib/socialLogic';
import type { AuthState } from '../lib/types';

export function FriendProfile({ auth }: { auth: AuthState }) {
  const { userId = '' } = useParams();
  const [profile, setProfile] = useState<FriendProfileModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busyPostId, setBusyPostId] = useState('');

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError('');
    setProfile(null);
    if (!auth.user?.uid || !userId) {
      setError('This profile is unavailable.');
      setLoading(false);
      return () => {
        disposed = true;
      };
    }
    loadFriendProfile(auth.user, userId)
      .then((nextProfile) => {
        if (!disposed) setProfile(nextProfile);
      })
      .catch((nextError: any) => {
        if (!disposed) setError(nextError?.message || 'Unable to load this profile.');
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [auth.user, userId]);

  const updatePost = (postId: string, update: (post: SocialFeedItem) => SocialFeedItem) => {
    setProfile((current) => current ? {
      ...current,
      posts: current.posts.map((post) => post.id === postId ? update(post) : post)
    } : current);
  };

  const toggleLike = async (post: SocialFeedItem) => {
    if (!auth.user || busyPostId) return;
    const previousLiked = post.viewerHasLiked;
    const previousCount = Number(post.reactionCounts.like || 0);
    setBusyPostId(post.id);
    setStatus('');
    updatePost(post.id, (current) => ({
      ...current,
      viewerHasLiked: !previousLiked,
      reactionCounts: {
        ...current.reactionCounts,
        like: Math.max(0, previousCount + (previousLiked ? -1 : 1))
      }
    }));
    try {
      const result = await reactToSocialPost(post.id, auth.user, 'like');
      updatePost(post.id, (current) => ({
        ...current,
        viewerHasLiked: result.liked,
        reactionCounts: { ...current.reactionCounts, like: result.count }
      }));
      setStatus(result.liked ? 'Post liked.' : 'Like removed.');
    } catch (nextError: any) {
      updatePost(post.id, (current) => ({
        ...current,
        viewerHasLiked: previousLiked,
        reactionCounts: { ...current.reactionCounts, like: previousCount }
      }));
      setStatus(nextError?.message || 'Unable to update this post.');
    } finally {
      setBusyPostId('');
    }
  };

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[45vh] max-w-3xl items-center justify-center px-4" aria-busy="true">
        <div className="flex items-center gap-2 text-sm font-black text-gray-600">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading profile…
        </div>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Link to="/home?section=friends" className="ghost-button !inline-flex !min-h-10 !px-3 text-sm">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to friends
        </Link>
        <section className="app-card mt-5 p-6 text-center">
          <AlertCircle className="mx-auto h-9 w-9 text-amber-600" aria-hidden="true" />
          <h1 className="mt-3 text-xl font-black text-gray-950">Profile unavailable</h1>
          <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-gray-600">{error || 'This profile is unavailable.'}</p>
        </section>
      </main>
    );
  }

  const initials = getInitials(profile.name);
  return (
    <main className="mx-auto max-w-3xl px-4 py-5 sm:py-7">
      <Link to="/home?section=friends" className="ghost-button !inline-flex !min-h-10 !px-3 text-sm">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to friends
      </Link>

      <header className="app-card mt-4 overflow-hidden">
        <div className="h-24 bg-gradient-to-br from-primary-700 via-primary-600 to-sky-500 sm:h-32" />
        <div className="px-5 pb-5 sm:px-7">
          <div className="-mt-10 flex items-end justify-between gap-4">
            {profile.photoUrl ? (
              <AvatarImage
                src={profile.photoUrl}
                alt=""
                className="h-20 w-20 rounded-2xl border-4 border-white bg-white object-cover shadow-sm sm:h-24 sm:w-24"
                fallback={<div className="flex h-20 w-20 items-center justify-center rounded-2xl border-4 border-white bg-gray-950 text-xl font-black text-white shadow-sm sm:h-24 sm:w-24">{initials}</div>}
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border-4 border-white bg-gray-950 text-xl font-black text-white shadow-sm sm:h-24 sm:w-24">{initials}</div>
            )}
            <span className="mb-1 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
              {profile.isSelf ? 'Your profile' : 'Friend'}
            </span>
          </div>
          <h1 className="mt-3 text-2xl font-black text-gray-950 sm:text-3xl">{profile.name}</h1>
          {profile.sharedTeamNames.length ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-primary-700">
              <UsersRound className="h-4 w-4" aria-hidden="true" />
              Connected through {profile.sharedTeamNames.join(' · ')}
            </p>
          ) : null}
          <div className="mt-4 flex gap-5 border-t border-gray-100 pt-4 text-sm">
            <div><span className="font-black text-gray-950">{profile.posts.length}</span> <span className="font-semibold text-gray-500">shared posts</span></div>
            <div><span className="font-black text-gray-950">{profile.sharedTeamNames.length}</span> <span className="font-semibold text-gray-500">shared teams</span></div>
          </div>
        </div>
      </header>

      <section className="mt-6" aria-labelledby="profile-posts-heading">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-primary-700">Timeline</p>
            <h2 id="profile-posts-heading" className="mt-1 text-xl font-black text-gray-950">Recent posts</h2>
          </div>
          <span className="text-xs font-bold text-gray-500">Newest first</span>
        </div>
        {status ? <div className="mt-3 rounded-xl bg-gray-950 px-3 py-2 text-sm font-bold text-white" role="status">{status}</div> : null}
        <div className="mt-3 space-y-3">
          {profile.posts.length ? profile.posts.map((post) => (
            <article key={post.id} className="app-card overflow-hidden p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-gray-700">{getSocialTypeLabel(post.type)}</span>
                <span className="rounded-full bg-primary-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-primary-700">{getSocialVisibilityLabel(post.visibility)}</span>
                <time className="ml-auto text-xs font-bold text-gray-500" dateTime={post.createdAt.toISOString()}>{formatPostDate(post.createdAt)}</time>
              </div>
              <h3 className="mt-3 text-lg font-black text-gray-950">{post.title}</h3>
              {post.detail ? <p className="mt-1 text-sm font-semibold leading-6 text-gray-600">{post.detail}</p> : null}
              {post.caption ? <p className="mt-3 rounded-xl bg-gray-50 p-3 text-sm font-semibold leading-6 text-gray-800">{post.caption}</p> : null}
              {post.media.length ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {post.media.slice(0, 4).map((media) => media.type === 'video' ? (
                    <video key={media.url} src={media.url} controls className="h-52 w-full rounded-xl bg-black object-contain" />
                  ) : (
                    <img key={media.url} src={media.url} alt={media.name || post.title} loading="lazy" className="h-52 w-full rounded-xl object-cover" />
                  ))}
                </div>
              ) : null}
              <div className="mt-4 flex items-center gap-3 border-t border-gray-100 pt-3">
                <button
                  type="button"
                  className={`ghost-button !min-h-9 !px-3 text-xs ${post.viewerHasLiked ? '!border-rose-200 !bg-rose-50 !text-rose-700' : ''}`}
                  disabled={Boolean(busyPostId)}
                  onClick={() => toggleLike(post)}
                  aria-label={`${post.viewerHasLiked ? 'Unlike' : 'Like'} post, ${Number(post.reactionCounts.like || 0)} likes`}
                >
                  <Heart className={`h-4 w-4 ${post.viewerHasLiked ? 'fill-current' : ''}`} aria-hidden="true" />
                  {busyPostId === post.id ? 'Saving…' : Number(post.reactionCounts.like || 0)}
                </button>
                {post.teamName ? <span className="text-xs font-bold text-gray-500">{post.teamName}</span> : null}
              </div>
            </article>
          )) : (
            <div className="app-card p-8 text-center">
              <h3 className="text-base font-black text-gray-950">Nothing shared yet</h3>
              <p className="mt-1 text-sm font-semibold text-gray-500">Posts shared with you will appear here.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'AP';
}

function formatPostDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
  }).format(date);
}
