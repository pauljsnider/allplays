export const allPlaysProductionFirebaseProjectId = 'game-flow-c6311';

type NativeAuthBackendContext = {
  projectId: string;
  emulatorConfigured?: boolean;
  buildMode?: string;
};

/**
 * The native REST bridge intentionally has no silent emulator fallback. A
 * production/native binary must never authenticate against a different
 * Firebase tenant, and an emulator-configured SDK must never leak credentials
 * to the production Identity Toolkit endpoints.
 */
export function assertNativeAuthBackendPolicy({
  projectId,
  emulatorConfigured = false,
  buildMode = ''
}: NativeAuthBackendContext) {
  if (emulatorConfigured) {
    throw new Error('Native REST authentication is disabled while the Firebase Auth emulator is configured.');
  }

  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) {
    throw new Error('Firebase project identity is missing.');
  }

  // Unit tests use isolated fake projects. Native release and debug bundles
  // both use the real ALL PLAYS project until a complete emulator stack exists.
  if (buildMode !== 'test' && normalizedProjectId !== allPlaysProductionFirebaseProjectId) {
    throw new Error('This native build is not configured for the ALL PLAYS Firebase project.');
  }
}
