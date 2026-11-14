import { resolvePublicOrigin as legacyResolvePublicOrigin } from '@legacy/public-origin.js';

export const resolvePublicOrigin = legacyResolvePublicOrigin as (origin?: string) => string;
