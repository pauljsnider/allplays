import { Camera, CameraResultType, CameraSource, type CameraPhoto } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { isNativeRuntime } from './nativeRuntime';
import { uploadUserPhoto } from './adapters/legacyProfilePhotoDb';
import { uploadNativeUserProfilePhoto } from './nativeStorageUpload';

const profileTimeoutMs = 8000;
const nativeImageUploadTimeoutMs = 20000;
const profilePhotoMaxDimensionPx = 1024;
const profilePhotoMaxBytes = 512 * 1024;
const profilePhotoQuality = 0.82;

export type ProfilePhotoSource = 'camera' | 'photos';

export class ProfilePhotoAcquireError extends Error {
  code: 'permission-denied' | 'cancelled' | 'unavailable' | 'failed';

  constructor(code: 'permission-denied' | 'cancelled' | 'unavailable' | 'failed', message: string) {
    super(message);
    this.name = 'ProfilePhotoAcquireError';
    this.code = code;
  }
}

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
  const format = String(photo.format || '')
    .trim()
    .toLowerCase();
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
  const imageBitmapFactory = (globalThis as typeof globalThis & { createImageBitmap?: (image: Blob) => Promise<ImageBitmap> })
    .createImageBitmap;
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
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('Profile photo could not be normalized.'));
      },
      type,
      quality
    );
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
    return normalizeProfilePhoto(
      new File([blob], buildPhotoFileName(source, photo, mimeType), {
        type: mimeType,
        lastModified: Date.now()
      })
    );
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

export async function nativeUploadProfilePhoto(file: File, uid = '') {
  return uploadNativeUserProfilePhoto(file, uid);
}

export async function uploadProfilePhoto(file: File, uid = '') {
  if (isNativeRuntime()) {
    return nativeUploadProfilePhoto(file, uid);
  }
  return withTimeout(uploadUserPhoto(file, uid) as Promise<string>, 'Profile photo upload', nativeImageUploadTimeoutMs);
}
