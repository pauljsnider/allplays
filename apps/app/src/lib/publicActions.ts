import { AppLauncher } from '@capacitor/app-launcher';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export type SharePublicUrlInput = {
  title: string;
  text: string;
  url?: string;
  clipboardText?: string;
};

export type SharePublicUrlResult = 'shared' | 'copied' | 'failed' | 'cancelled';

export type CopyPublicTextResult = 'copied' | 'failed';

export type ExportCalendarIcsResult = 'shared' | 'downloaded';

export type ExportCertificatePngResult = 'shared' | 'downloaded';

function isNativePluginAvailable(pluginName: string) {
  return Capacitor.isNativePlatform() && Boolean((Capacitor as any).isPluginAvailable?.(pluginName));
}

function appendUrlToShareText(text: string, url: string) {
  const trimmedText = String(text || '').trim();
  const trimmedUrl = String(url || '').trim();
  if (!trimmedUrl) return trimmedText;
  if (trimmedText.includes(trimmedUrl)) return trimmedText;
  return trimmedText ? `${trimmedText}\n${trimmedUrl}` : trimmedUrl;
}

export async function openPublicUrl(url: string) {
  if (!url) return;
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  const isWebUrl = scheme === 'http' || scheme === 'https';
  if (isWebUrl && isNativePluginAvailable('Browser')) {
    await Browser.open({ url });
    return;
  }
  if (scheme === 'webcal' && Capacitor.isNativePlatform()) {
    if (!isNativePluginAvailable('AppLauncher')) {
      throw new Error('No application is available to open this URL.');
    }
    const result = await AppLauncher.openUrl({ url });
    if (!result.completed) {
      throw new Error('No application is available to open this URL.');
    }
    return;
  }
  if (scheme && !isWebUrl && Capacitor.isNativePlatform()) {
    throw new Error('Unsupported URL scheme.');
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    window.location.href = url;
  }
}

export async function copyPublicText(text: string): Promise<CopyPublicTextResult> {
  const value = String(text || '');
  if (!value) return 'failed';

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return 'copied';
    }
  } catch {
    // Fall back to the textarea path below for WebViews or blocked clipboard APIs.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand?.('copy') === true;
    document.body.removeChild(textarea);
    return copied ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function sharePublicUrl(input: SharePublicUrlInput): Promise<SharePublicUrlResult> {
  if (!input.url && !input.text) return 'failed';
  const shareText = input.clipboardText || appendUrlToShareText(input.text, input.url || '');

  try {
    if (isNativePluginAvailable('Share')) {
      await Share.share({
        title: input.title,
        text: shareText,
        ...(input.url ? { url: input.url } : {}),
        dialogTitle: input.title
      });
      return 'shared';
    }

    if (navigator.share) {
      await navigator.share({
        title: input.title,
        text: shareText,
        ...(input.url ? { url: input.url } : {})
      });
      return 'shared';
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareText);
      return 'copied';
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') return 'cancelled';
  }

  return 'failed';
}

export async function exportCalendarIcsFile(filename: string, icsText: string): Promise<ExportCalendarIcsResult> {
  const safeFilename = sanitizeFileName(filename || 'all-plays-schedule.ics', 'ics', 'all-plays-schedule');
  const calendarText = String(icsText || '');
  if (!calendarText.trim()) throw new Error('Calendar export is empty.');

  if (isNativePluginAvailable('Filesystem') && isNativePluginAvailable('Share')) {
    const canShare = await Share.canShare?.();
    if (canShare && canShare.value === false) {
      throw new Error('Sharing is not available on this device. Try the Apple or Google calendar links instead.');
    }

    const writeResult = await Filesystem.writeFile({
      path: `calendar-exports/${Date.now()}-${safeFilename}`,
      data: calendarText,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true
    });

    await Share.share({
      title: 'ALL PLAYS calendar export',
      text: 'Share this .ics file with Calendar, Files, Gmail, or another app.',
      files: [writeResult.uri],
      dialogTitle: 'Export calendar'
    });

    return 'shared';
  }

  downloadBlobFile(safeFilename, calendarText, 'text/calendar;charset=utf-8');
  return 'downloaded';
}

export async function exportCertificatePngFile(filename: string, pngBlob: Blob): Promise<ExportCertificatePngResult> {
  const safeFilename = sanitizeFileName(filename || 'all-plays-certificate.png', 'png', 'all-plays-certificate');
  if (!pngBlob || pngBlob.size <= 0) throw new Error('Certificate export is empty.');

  if (isNativePluginAvailable('Filesystem') && isNativePluginAvailable('Share')) {
    const canShare = await Share.canShare?.();
    if (canShare && canShare.value === false) {
      throw new Error('Sharing is not available on this device. Try exporting from the website instead.');
    }

    const writeResult = await Filesystem.writeFile({
      path: `certificate-exports/${Date.now()}-${safeFilename}`,
      data: await blobToBase64(pngBlob),
      directory: Directory.Cache,
      recursive: true
    });

    await Share.share({
      title: 'ALL PLAYS certificate export',
      text: 'Share this certificate image with Files, AirPrint, or another app.',
      files: [writeResult.uri],
      dialogTitle: 'Export certificate'
    });

    return 'shared';
  }

  downloadBlobFile(safeFilename, pngBlob, 'image/png');
  return 'downloaded';
}

function downloadBlobFile(filename: string, fileBody: Blob | string, contentType: string) {
  const blob = fileBody instanceof Blob ? fileBody : new Blob([fileBody], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Unable to read certificate export.'));
    reader.readAsDataURL(blob);
  });
  return dataUrl.split(',')[1] || '';
}

function sanitizeFileName(value: string, extension: string, fallbackBase: string) {
  const clean = String(value || `${fallbackBase}.${extension}`).trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  const suffix = `.${extension.toLowerCase()}`;
  return clean.toLowerCase().endsWith(suffix) ? clean : `${clean || fallbackBase}.${extension}`;
}
