import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

export type SharePublicUrlInput = {
  title: string;
  text: string;
  url?: string;
  clipboardText?: string;
};

export type SharePublicUrlResult = 'shared' | 'copied' | 'failed' | 'cancelled';

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
