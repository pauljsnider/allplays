import {
  getPrimaryAppCheckHeaders as legacyGetPrimaryAppCheckHeaders,
  getPrimaryAppCheckToken as legacyGetPrimaryAppCheckToken
} from '@legacy/firebase-app-check-rest.js';

export const getPrimaryAppCheckToken = legacyGetPrimaryAppCheckToken as (
  forceRefresh?: boolean
) => Promise<string | null>;

export const getPrimaryAppCheckHeaders = legacyGetPrimaryAppCheckHeaders as (
  headers?: Record<string, string>,
  requestUrl?: string
) => Promise<Record<string, string>>;
