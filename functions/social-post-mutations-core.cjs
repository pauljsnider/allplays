'use strict';

function normalizeSocialPostId(value) {
  const postId = typeof value === 'string' ? value.trim() : '';
  return postId && !postId.includes('/') && postId.length <= 1500 ? postId : '';
}

function canReadSocialPostForCaller({ post, callerUid, isGlobalAdmin, canAccessTeam }) {
  const data = post && typeof post === 'object' && !Array.isArray(post) ? post : {};
  const uid = typeof callerUid === 'string' &&
    callerUid === callerUid.trim() &&
    callerUid.length > 0 &&
    callerUid.length <= 128 &&
    !callerUid.includes('/')
    ? callerUid
    : '';
  if (!uid || data.hidden === true) return false;
  const visibleUserIds = Array.isArray(data.visibleUserIds)
    ? data.visibleUserIds.filter((value) => typeof value === 'string')
    : [];
  return data.authorId === uid ||
    visibleUserIds.includes(uid) ||
    canAccessTeam === true ||
    isGlobalAdmin === true;
}

function getNextSocialPostLikeState({ reactionExists, currentCount }) {
  const count = currentCount == null ? 0 : currentCount;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('Social post like count is invalid.');
  }
  return reactionExists === true
    ? { liked: false, count: Math.max(0, count - 1) }
    : { liked: true, count: count + 1 };
}

module.exports = {
  canReadSocialPostForCaller,
  getNextSocialPostLikeState,
  normalizeSocialPostId
};
