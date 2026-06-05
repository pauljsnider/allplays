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
  if (isNativePluginAvailable('Browser')) {
    await Browser.open({ url });
    return;
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
  const safeFilename = sanitizeFileName(filename || 'all-plays-schedule.ics');
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

function downloadBlobFile(filename: string, fileText: string, contentType: string) {
  const blob = new Blob([fileText], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function sanitizeFileName(value: string) {
  const clean = String(value || 'all-plays-schedule.ics').trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  return clean.toLowerCase().endsWith('.ics') ? clean : `${clean || 'all-plays-schedule'}.ics`;
}
