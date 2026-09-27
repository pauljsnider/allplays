import { resolveImageFirebaseConfig as legacyResolveImageFirebaseConfig } from '@legacy/firebase-runtime-config.js';
import {
  deleteLegacyImageUpload as legacyDeleteLegacyImageUpload,
  uploadUserPhoto as legacyUploadUserPhoto
} from '@legacy/db.js';

export type ProfilePhotoUploadResult = {
  url: string;
  path: string;
};

/**
 * Typed adapter boundary for the legacy js/ profile-photo upload helpers (#2066).
 */
export function resolveImageFirebaseConfig(): any {
  return legacyResolveImageFirebaseConfig() ?? {};
}

export function uploadUserPhoto(file: File, uid = ''): Promise<ProfilePhotoUploadResult> {
  return Promise.resolve(legacyUploadUserPhoto(file, uid, { returnUpload: true })) as Promise<ProfilePhotoUploadResult>;
}

export function deleteUserPhoto(path: string): Promise<void> {
  return Promise.resolve(legacyDeleteLegacyImageUpload(path)) as Promise<void>;
}
