export type LegacyAccessCodeValidationOptions = {
  nativeAuthToken?: string;
};

export type LegacyAccessCodeValidation = {
  valid: boolean;
  type?: string;
  codeId: string;
  message?: string;
  data?: {
    code?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type LegacyAuthDbModule = {
  validateAccessCode: (code: string, options?: LegacyAccessCodeValidationOptions) => Promise<LegacyAccessCodeValidation>;
  redeemParentInvite: (userId: string, code: string, email?: string | null) => Promise<unknown>;
  redeemHouseholdInvite: (...args: any[]) => Promise<unknown>;
  redeemCoParentInvite: (...args: any[]) => Promise<unknown>;
  redeemAdminInviteAtomically: (...args: any[]) => Promise<unknown>;
  markAccessCodeAsUsed: (codeId: string, userId: string) => Promise<unknown>;
  updateUserProfile: (userId: string, profile: Record<string, unknown>) => Promise<unknown>;
  updateTeam: (...args: any[]) => Promise<unknown>;
  getTeam: (...args: any[]) => Promise<unknown>;
  getUserProfile: (...args: any[]) => Promise<Record<string, unknown> | null | undefined>;
  getUserTeams: (userId: string) => Promise<Array<Record<string, unknown>>>;
  listMyParentMembershipRequests: (userId: string) => Promise<unknown[]>;
};

export type LegacyAdminInviteModule = {
  redeemAdminInviteAcceptance: (...args: any[]) => Promise<unknown>;
  redeemAdminInviteAtomically: (...args: any[]) => Promise<unknown>;
};

export type LegacyInviteRedemptionResult = {
  message?: string;
  redirectUrl?: string;
  [key: string]: unknown;
};

export type LegacyInviteProcessor = (
  userId: string,
  code: string,
  authEmail?: string | null
) => Promise<LegacyInviteRedemptionResult>;

export type LegacyInviteFlowModule = {
  createInviteProcessor: (...args: any[]) => LegacyInviteProcessor;
};

export type LegacySignupFlowModule = {
  executeEmailPasswordSignup: (...args: any[]) => Promise<unknown>;
};

export type LegacyAuthEmailModule = {
  queuePasswordResetEmail: (email: string) => Promise<unknown>;
  queueCurrentUserVerificationEmail: (idToken?: string) => Promise<unknown>;
  queueInviteSignInEmail: (inviteCode: string) => Promise<unknown>;
};

export type LegacyParentMembershipSync = {
  changed: boolean;
  userUpdate: Record<string, unknown>;
};

export type LegacyParentMembershipUtilsModule = {
  mergeApprovedParentMembershipRequests: (
    profile: Record<string, unknown>,
    requests: unknown[]
  ) => LegacyParentMembershipSync;
};

let authDbPromise: Promise<LegacyAuthDbModule> | null = null;
let adminInvitePromise: Promise<LegacyAdminInviteModule> | null = null;
let inviteFlowPromise: Promise<LegacyInviteFlowModule> | null = null;
let signupFlowPromise: Promise<LegacySignupFlowModule> | null = null;
let authEmailPromise: Promise<LegacyAuthEmailModule> | null = null;
let parentMembershipUtilsPromise: Promise<LegacyParentMembershipUtilsModule> | null = null;

export function loadLegacyAuthDb() {
  authDbPromise ||= import('@legacy/db.js') as Promise<LegacyAuthDbModule>;
  return authDbPromise;
}

export function loadLegacyAdminInvite() {
  adminInvitePromise ||= import('@legacy/admin-invite.js') as Promise<LegacyAdminInviteModule>;
  return adminInvitePromise;
}

export function loadLegacyInviteFlow() {
  inviteFlowPromise ||= import('@legacy/accept-invite-flow.js') as Promise<LegacyInviteFlowModule>;
  return inviteFlowPromise;
}

export function loadLegacySignupFlow() {
  signupFlowPromise ||= import('@legacy/signup-flow.js') as Promise<LegacySignupFlowModule>;
  return signupFlowPromise;
}

export function loadLegacyAuthEmail() {
  authEmailPromise ||= import('@legacy/auth-email.js') as Promise<LegacyAuthEmailModule>;
  return authEmailPromise;
}

export function loadLegacyParentMembershipUtils() {
  parentMembershipUtilsPromise ||= import('@legacy/parent-membership-utils.js') as Promise<LegacyParentMembershipUtilsModule>;
  return parentMembershipUtilsPromise;
}
