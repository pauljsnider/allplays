const routePreloaders: Array<{ pattern: RegExp; load: () => Promise<unknown> }> = [
  { pattern: /^\/home$/, load: () => import('../pages/Home') },
  { pattern: /^\/schedule$/, load: () => import('../pages/Schedule') },
  { pattern: /^\/schedule\/[^/]+\/[^/]+$/, load: () => import('../pages/ScheduleEventDetail') },
  { pattern: /^\/messages(?:\/[^/]+)?$/, load: () => import('../pages/Messages') },
  { pattern: /^\/teams\/browse$/, load: () => import('../pages/PublicTeamsBrowse') },
  { pattern: /^\/teams$/, load: () => import('../pages/Teams') },
  { pattern: /^\/teams\/[^/]+$/, load: () => import('../pages/TeamDetail') },
  { pattern: /^\/teams\/[^/]+\/edit$/, load: () => import('../pages/TeamSettings') },
  { pattern: /^\/teams\/[^/]+\/fees(?:\/[^/]+)?$/, load: () => import('../pages/TeamFees') },
  { pattern: /^\/teams\/[^/]+\/media$/, load: () => import('../pages/TeamMedia') },
  { pattern: /^\/parent-tools(?:\/[^/]+(?:\/[^/]+\/[^/]+)?)?$/, load: () => import('../pages/ParentTools') },
  { pattern: /^\/players(?:\/[^/]+){1,2}$/, load: () => import('../pages/PlayerDetail') },
  { pattern: /^\/games\/[^/]+$/, load: () => import('../pages/GameDetail') },
  { pattern: /^\/help(?:\/[^/]+)?$/, load: async () => {
    await Promise.all([import('../pages/HelpPortal'), import('../pages/HelpArticle')]);
  } },
  { pattern: /^\/profile$/, load: () => import('../pages/Profile') },
  { pattern: /^\/ai$/, load: () => import('../pages/PrivateAiChat') },
  { pattern: /^\/capabilities\/[^/]+$/, load: () => import('../pages/CapabilityPage') },
  { pattern: /^\/registration$/, load: () => import('../pages/RegistrationDetail') },
  { pattern: /^\/accept-invite$/, load: () => import('../pages/AcceptInvite') },
  { pattern: /^\/verify-pending$/, load: () => import('../pages/VerifyPending') },
  { pattern: /^\/reset-password$/, load: () => import('../pages/ResetPassword') },
  { pattern: /^\/auth$/, load: () => import('../pages/AuthPage') }
];

export function resolveSearchRoutePreloader(route: string) {
  return routePreloaders.find(({ pattern }) => pattern.test(route))?.load ?? null;
}

export async function preloadSearchRoute(route: string) {
  const load = resolveSearchRoutePreloader(route);
  if (!load) return false;

  try {
    await load();
    return true;
  } catch {
    return false;
  }
}
