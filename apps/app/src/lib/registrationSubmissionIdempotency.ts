export type RegistrationSubmissionAttempt = {
  fingerprint: string;
  token: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value ?? '';
  return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = canonicalize((value as Record<string, unknown>)[key]);
    return result;
  }, {});
}

export function getOrCreateRegistrationSubmissionAttempt(
  current: RegistrationSubmissionAttempt | null,
  submission: Record<string, unknown>,
  tokenFactory: () => string
): RegistrationSubmissionAttempt {
  const fingerprint = JSON.stringify(canonicalize(submission));
  if (current?.fingerprint === fingerprint && current.token) return current;
  return { fingerprint, token: tokenFactory() };
}
