import { resolveImageFirebaseConfig as legacyResolveImageFirebaseConfig } from '@legacy/firebase-runtime-config.js';
import { uploadUserPhoto as legacyUploadUserPhoto } from '@legacy/db.js';

/**
 * Typed adapter boundary for the legacy js/ profile-photo upload helpers (#2066).
 */
export function resolveImageFirebaseConfig(): any {
  return legacyResolveImageFirebaseConfig() ?? {};
}

export function uploadUserPhoto(file: File): Promise<string> {
  return Promise.resolve(legacyUploadUserPhoto(file)) as Promise<string>;
}
