import { Capacitor } from '@capacitor/core';
import { createLogger } from './logger';

const logger = createLogger('native');

export async function initializeNativeAppearance() {
  if (!isNativeRuntime()) {
    return;
  }

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#ffffff' });
  } catch (error) {
    logger.warn('Unable to configure status bar.', { error });
  }
}

export async function hideNativeSplashScreen() {
  if (!isNativeRuntime()) {
    return;
  }

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 150 });
  } catch (error) {
    logger.warn('Unable to hide splash screen.', { error });
  }
}

function isNativeRuntime() {
  return Capacitor.isNativePlatform() || (typeof window !== 'undefined' && window.location.protocol === 'capacitor:');
}
