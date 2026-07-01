import {
  Camera,
  CameraResultType,
  CameraSource,
  type CameraPhoto
} from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { resolveImageFirebaseConfig } from './adapters/legacyProfilePhotoDb';
import { createLogger } from './logger';
import { isNativeRuntime } from './nativeRuntime';
import { uploadUserPhoto } from './adapters/legacyProfilePhotoDb';

const profileTimeoutMs = 8000;
const nativeImageUploadTimeoutMs = 20000;
const imageUploadSessionKey = 'allplays-image-upload-session';
const profilePhotoMaxDimensionPx = 1024;
const profilePhotoMaxBytes = 512 * 1024;
const profilePhotoQuality = 0.82;
const logger = createLogger('profile-photo-service');

export type ProfilePhotoSource = 'camera' | 'photos';

export class ProfilePhotoAcquireError extends Error {
  code: 'permission-denied' | 'cancelled' | 'unavailable' | 'failed';

  constructor(code: 'permission-denied' | 'cancelled' | 'unavailable' | 'failed', message: string) {
    super(message);
    this.name = 'ProfilePhotoAcquireError';
    this.code = code;
  }
}

type ImageUploadSession = {
  apiKey: string;
  idToken: string;
  refreshToken: string;
  expirationTime: number;
};

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = profileTimeoutMs): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  });
}

function isNativeCameraAvailable() {
  return Capacitor.isNativePlatform() && Boolean((Capacitor as any).isPluginAvailable?.('Camera'));
}

function inferPhotoMimeType(photo: CameraPhoto, fallbackBlob?: Blob) {
  const format = String(photo.format || '').trim().toLowerCase();
  if (format) {
    return format === 'jpg' ? 'image/jpeg' : `image/${format}`;
  }
  if (fallbackBlob?.type) {
    return fallbackBlob.type;
  }
  return 'image/jpeg';
}

function buildPhotoFileName(source: ProfilePhotoSource, photo: CameraPhoto, mimeType: string) {
  const extension = mimeType.split('/')[1] || 'jpg';
  const baseName = source === 'camera' ? 'profile-camera' : 'profile-library';
  return `${baseName}-${Date.now()}.${extension.replace(/[^a-z0-9]+/gi, '') || 'jpg'}`;
}

function isPermissionDeniedError(error: unknown) {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return message.includes('permission') || message.includes('denied') || message.includes('not authorized');
}

function isCancellationError(error: unknown) {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return message.includes('cancel') || message.includes('user denied') || message.includes('no image picked');
}

function shouldNormalizeProfilePhoto(file: File, width: number, height: number) {
  return width > profilePhotoMaxDimensionPx || height > profilePhotoMaxDimensionPx || file.size > profilePhotoMaxBytes;
}

function getNormalizedProfilePhotoType(file: File) {
  return file.type === 'image/png' ? 'image/png' : 'image/jpeg';
}

function loadProfilePhotoImage(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  const imageBitmapFactory = (globalThis as typeof globalThis & { createImageBitmap?: (image: Blob) => Promise<ImageBitmap> }).createImageBitmap;
  if (typeof imageBitmapFactory === 'function') {
    return imageBitmapFactory(file).then((bitmap) => ({
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close()
    }));
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({
        image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        cleanup: () => URL.revokeObjectURL(objectUrl)
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Profile photo could not be decoded.'));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('Profile photo could not be normalized.'));
    }, type, quality);
  });
}

export async function normalizeProfilePhoto(file: File): Promise<File> {
  if (!(file instanceof File) || !file.type.startsWith('image/') || typeof document === 'undefined') {
    return file;
  }

  const { image, width, height, cleanup } = await loadProfilePhotoImage(file);

  try {
    if (!shouldNormalizeProfilePhoto(file, width, height)) {
      return file;
    }

    const scale = Math.min(1, profilePhotoMaxDimensionPx / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const outputType = getNormalizedProfilePhotoType(file);
    const blob = await canvasToBlob(canvas, outputType, outputType === 'image/png' ? undefined : profilePhotoQuality);

    if (blob.size >= file.size && targetWidth === width && targetHeight === height) {
      return file;
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'profile-photo';
    const extension = outputType === 'image/png' ? 'png' : 'jpg';
    return new File([blob], `${baseName}.${extension}`, {
      type: outputType,
      lastModified: Date.now()
    });
  } finally {
    cleanup();
  }
}

export async function acquireProfilePhoto(source: ProfilePhotoSource): Promise<File> {
  if (!isNativeRuntime()) {
    throw new ProfilePhotoAcquireError('unavailable', 'Native profile photo capture is only available in the mobile app.');
  }

  if (!isNativeCameraAvailable()) {
    throw new ProfilePhotoAcquireError('unavailable', 'Camera access is not available on this device yet.');
  }

  try {
    const photo = await Camera.getPhoto({
      quality: 85,
      resultType: CameraResultType.Uri,
      source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      correctOrientation: true,
      width: profilePhotoMaxDimensionPx,
      height: profilePhotoMaxDimensionPx
    });

    if (!photo.webPath) {
      throw new ProfilePhotoAcquireError('failed', 'Photo data was unavailable after selection.');
    }

    const response = await fetch(photo.webPath);
    if (!response.ok) {
      throw new ProfilePhotoAcquireError('failed', `Photo data could not be loaded (${response.status}).`);
    }

    const blob = await response.blob();
    const mimeType = inferPhotoMimeType(photo, blob);
    return normalizeProfilePhoto(new File([blob], buildPhotoFileName(source, photo, mimeType), {
      type: mimeType,
      lastModified: Date.now()
    }));
  } catch (error) {
    if (error instanceof ProfilePhotoAcquireError) {
      throw error;
    }
    if (isCancellationError(error)) {
      throw new ProfilePhotoAcquireError('cancelled', 'Photo selection was cancelled.');
    }
    if (isPermissionDeniedError(error)) {
      throw new ProfilePhotoAcquireError('permission-denied', 'Photo access permission was denied.');
    }
    throw new ProfilePhotoAcquireError('failed', String((error as any)?.message || 'Photo selection failed.'));
  }
}

function readImageUploadSession(): ImageUploadSession | null {
  try {
    const raw = window.localStorage?.getItem(imageUploadSessionKey);
    return raw ? JSON.parse(raw) as ImageUploadSession : null;
  } catch {
    return null;
  }
}

function writeImageUploadSession(session: ImageUploadSession) {
  try {
    window.localStorage?.setItem(imageUploadSessionKey, JSON.stringify(session));
  } catch (error) {
    logger.warn('Unable to persist image upload auth session.', { error });
  }
}

// Firebase web API keys are public project identifiers. Security is enforced by Firebase Auth and Storage rules.
async function getImageUploadSession(apiKey: string): Promise<ImageUploadSession> {
  const current = readImageUploadSession();
  if (current?.apiKey === apiKey && current.idToken && current.refreshToken) {
    if (Number(current.expirationTime || 0) > Date.now() + 60000) {
      return current;
    }
    try {
      return await refreshImageUploadSession(current);
    } catch (error) {
      logger.warn('Image upload auth refresh failed, creating a new anonymous session.', { error });
    }
  }

  return createImageUploadSession(apiKey);
}

async function refreshImageUploadSession(session: ImageUploadSession): Promise<ImageUploadSession> {
  const response = await withTimeout(fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(session.apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken
    })
  }), 'Image upload auth refresh', profileTimeoutMs);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Image upload auth refresh failed.');
  }

  const nextSession = {
    apiKey: session.apiKey,
    idToken: payload.id_token || session.idToken,
    refreshToken: payload.refresh_token || session.refreshToken,
    expirationTime: Date.now() + Math.max(Number.parseInt(payload.expires_in || '3600', 10) - 30, 60) * 1000
  };
  writeImageUploadSession(nextSession);
  return nextSession;
}

async function createImageUploadSession(apiKey: string): Promise<ImageUploadSession> {
  const response = await withTimeout(fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ returnSecureToken: true })
  }), 'Image upload auth', profileTimeoutMs);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Image upload auth failed.');
  }

  const session = {
    apiKey,
    idToken: payload.idToken,
    refreshToken: payload.refreshToken,
    expirationTime: Date.now() + Math.max(Number.parseInt(payload.expiresIn || '3600', 10) - 30, 60) * 1000
  };
  if (!session.idToken || !session.refreshToken) {
    throw new Error('Image upload auth did not return a usable token.');
  }
  writeImageUploadSession(session);
  return session;
}

export async function nativeUploadProfilePhoto(file: File) {
  const imageConfig = resolveImageFirebaseConfig();
  const bucket = imageConfig.storageBucket;
  if (!imageConfig.apiKey || !bucket) {
    throw new Error('Image upload Firebase config is missing.');
  }

  const session = await getImageUploadSession(imageConfig.apiKey);
  const safeName = String(file.name || 'profile-photo').replace(/[^\w.-]+/g, '_');
  const path = `user-photos/${Date.now()}_${safeName}`;
  const response = await withTimeout(fetch(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': file.type || 'application/octet-stream'
    },
    body: file
  }), 'Profile photo upload', nativeImageUploadTimeoutMs);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Profile photo upload failed (${response.status}).`);
  }

  const token = payload.downloadTokens || payload.metadata?.firebaseStorageDownloadTokens;
  if (token) {
    return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(payload.name || path)}?alt=media&token=${encodeURIComponent(String(token).split(',')[0])}`;
  }

  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(payload.name || path)}?alt=media`;
}

export async function uploadProfilePhoto(file: File) {
  if (isNativeRuntime()) {
    try {
      return await nativeUploadProfilePhoto(file);
    } catch (error) {
      logger.warn('Native profile photo upload failed, falling back to SDK upload.', { error });
    }
  }

  try {
    return await withTimeout(uploadUserPhoto(file) as Promise<string>, 'Profile photo upload', nativeImageUploadTimeoutMs);
  } catch (error) {
    logger.warn('Falling back to REST profile photo upload.', { error });
    return nativeUploadProfilePhoto(file);
  }
}
