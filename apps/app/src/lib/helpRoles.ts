import type { AuthState } from './types';

export type HelpRoleFilter = 'all' | 'parent' | 'coach' | 'admin' | 'member';

type HelpRoleAuth = Pick<AuthState, 'user' | 'roles' | 'isParent' | 'isCoach' | 'isAdmin' | 'isPlatformAdmin'>;

export function derivePrimaryHelpRole(auth: Partial<HelpRoleAuth> | null | undefined): HelpRoleFilter {
  const explicitRole = [...(auth?.roles || []), ...(auth?.user?.roles || [])]
    .map(normalizeHelpRole)
    .find((role): role is Exclude<HelpRoleFilter, 'all'> => Boolean(role));

  if (explicitRole) return explicitRole;
  if (auth?.isAdmin || auth?.isPlatformAdmin || auth?.user?.isAdmin || auth?.user?.isPlatformAdmin) return 'admin';
  if (auth?.isCoach) return 'coach';
  if (auth?.isParent) return 'parent';
  return 'all';
}

function normalizeHelpRole(role: unknown): Exclude<HelpRoleFilter, 'all'> | '' {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'platformadmin' || normalized === 'platform admin') return 'admin';
  if (normalized === 'administrator') return 'admin';
  if (normalized === 'parents') return 'parent';
  if (normalized === 'coaches') return 'coach';
  if (normalized === 'parent' || normalized === 'coach' || normalized === 'admin' || normalized === 'member') return normalized;
  return '';
}
