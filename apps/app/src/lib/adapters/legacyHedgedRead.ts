import {
  isRetryableReadTransportError as legacyIsRetryableReadTransportError,
  raceFirstSuccessfulRead as legacyRaceFirstSuccessfulRead
} from '@legacy/hedged-read.js';

export type HedgedReadResult<T> = {
  value: T;
  source: 'primary' | 'fallback';
  primaryError?: unknown;
};

export type HedgedReadOptions<T> = {
  primary: () => Promise<T> | T;
  fallback: () => Promise<T> | T;
  label?: string;
  fallbackDelayMs?: number;
  primaryTimeoutMs?: number;
  fallbackTimeoutMs?: number;
  shouldFallbackAfterPrimaryError?: (error: unknown) => boolean;
};

export const raceFirstSuccessfulRead = legacyRaceFirstSuccessfulRead as <T>(
  options: HedgedReadOptions<T>
) => Promise<HedgedReadResult<T>>;

export const isRetryableReadTransportError = legacyIsRetryableReadTransportError as (
  error: unknown
) => boolean;
