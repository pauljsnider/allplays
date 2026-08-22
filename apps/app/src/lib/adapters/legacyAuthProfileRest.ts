import { loadAuthProfileViaRest as legacyLoadAuthProfileViaRest } from '@legacy/auth-profile-rest.js';

type AuthProfileRestOptions = {
  auth: {
    app?: {
      options?: {
        projectId?: string;
      };
    };
  };
  user: {
    uid: string;
    getIdToken?: (forceRefresh?: boolean) => Promise<string>;
  };
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export const loadAuthProfileViaRest = legacyLoadAuthProfileViaRest as (
  options: AuthProfileRestOptions
) => Promise<Record<string, unknown> | null>;
